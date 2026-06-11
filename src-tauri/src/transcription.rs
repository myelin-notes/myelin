use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};

use scribble::{
    Backend, BackendStream, Opts, OutputType, Scribble, Segment, SegmentEncoder, WhisperBackend,
};
use serde::Serialize;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};

const MODEL_DIR: &str = "scribble-models";
const DEFAULT_MODEL_FILE: &str = "ggml-base.en.bin";
const DEFAULT_VAD_MODEL_FILE: &str = "ggml-silero-v6.2.0.bin";
const MODEL_PATH_ENV: &str = "MYELIN_SCRIBBLE_MODEL_PATH";
const VAD_MODEL_PATH_ENV: &str = "MYELIN_SCRIBBLE_VAD_MODEL_PATH";
const SEGMENT_EVENT: &str = "audio-transcription-segment";
const FINISHED_EVENT: &str = "audio-transcription-finished";
const TARGET_SAMPLE_RATE: u32 = 16_000;
const MIN_FINAL_TRANSCRIPTION_SAMPLES: u64 = TARGET_SAMPLE_RATE as u64;

type SampleSender = mpsc::SyncSender<TranscriptionMessage>;
type Sessions = Arc<Mutex<HashMap<String, SampleSender>>>;
type SharedScribble = Arc<Mutex<Scribble<WhisperBackend>>>;
type ScribbleEngine = Arc<Mutex<Option<SharedScribble>>>;

enum TranscriptionMessage {
    Samples { samples: Vec<f32>, sample_rate: u32 },
    Finish,
}

pub struct TranscriptionState {
    sessions: Sessions,
    engine: ScribbleEngine,
    next_id: AtomicU64,
}

impl TranscriptionState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            engine: Arc::new(Mutex::new(None)),
            next_id: AtomicU64::new(1),
        }
    }
}

impl Default for TranscriptionState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioTranscriptionSegmentPayload {
    session_id: String,
    element_id: String,
    text: String,
    start_seconds: f32,
    end_seconds: f32,
    language_code: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioTranscriptionFinishedPayload {
    session_id: String,
    element_id: String,
    error: Option<String>,
}

#[tauri::command]
pub fn start_audio_transcription(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    element_id: String,
    mime_type: String,
) -> Result<String, String> {
    let paths = resolve_model_paths(&app)?;
    let session_id = format!(
        "{}-{}",
        current_timestamp_ms(),
        state.next_id.fetch_add(1, Ordering::Relaxed)
    );
    let (tx, rx) = mpsc::sync_channel::<TranscriptionMessage>(64);

    {
        let mut sessions = lock_or_recover(&state.sessions);
        sessions.insert(session_id.clone(), tx);
    }

    let sessions = state.sessions.clone();
    let engine = state.engine.clone();
    let thread_session_id = session_id.clone();
    std::thread::spawn(move || {
        let result = catch_unwind(AssertUnwindSafe(|| {
            run_transcription_session(
                app.clone(),
                engine,
                paths,
                thread_session_id.clone(),
                element_id.clone(),
                mime_type,
                rx,
            )
        }))
        .unwrap_or_else(|panic| {
            Err(format!(
                "transcription worker panicked: {}",
                panic_payload_message(panic)
            ))
        });

        {
            let mut sessions = lock_or_recover(&sessions);
            sessions.remove(&thread_session_id);
        }

        let error = result.err();
        let _ = app.emit(
            FINISHED_EVENT,
            AudioTranscriptionFinishedPayload {
                session_id: thread_session_id,
                element_id,
                error,
            },
        );
    });

    Ok(session_id)
}

#[tauri::command]
pub fn push_audio_transcription_samples(
    state: State<'_, TranscriptionState>,
    session_id: String,
    samples: Vec<f32>,
    sample_rate: u32,
) -> Result<(), String> {
    let tx = {
        let sessions = lock_or_recover(&state.sessions);
        sessions.get(&session_id).cloned()
    }
    .ok_or_else(|| format!("audio transcription session not found: {session_id}"))?;

    let message = TranscriptionMessage::Samples {
        samples,
        sample_rate,
    };

    if tx.send(message).is_ok() {
        return Ok(());
    }

    let mut sessions = lock_or_recover(&state.sessions);
    sessions.remove(&session_id);
    Err(format!("audio transcription session closed: {session_id}"))
}

#[tauri::command]
pub fn finish_audio_transcription(
    state: State<'_, TranscriptionState>,
    session_id: String,
) -> Result<(), String> {
    let tx = {
        let sessions = lock_or_recover(&state.sessions);
        sessions.get(&session_id).cloned()
    };
    if let Some(tx) = tx {
        if tx.try_send(TranscriptionMessage::Finish).is_err() {
            let mut sessions = lock_or_recover(&state.sessions);
            sessions.remove(&session_id);
        }
    }
    Ok(())
}

fn run_transcription_session(
    app: AppHandle,
    engine: ScribbleEngine,
    paths: ModelPaths,
    session_id: String,
    element_id: String,
    _mime_type: String,
    rx: mpsc::Receiver<TranscriptionMessage>,
) -> Result<(), String> {
    let scribble = get_or_init_scribble(&engine, paths)?;
    let opts = Opts {
        model_key: None,
        enable_translate_to_english: false,
        enable_voice_activity_detection: false,
        language: None,
        output_type: OutputType::Json,
        incremental_min_window_seconds: 1,
    };

    let result = {
        let guard = lock_or_recover(&scribble);
        let last_emitted_end_samples = Arc::new(AtomicU64::new(0));
        let mut writer = TranscriptionEventWriter::new(
            app,
            session_id,
            element_id,
            last_emitted_end_samples.clone(),
        );
        let mut stream = guard
            .backend()
            .create_stream(&opts, &mut writer)
            .map_err(|e| format!("create scribble stream: {e}"))?;
        let mut resampler = PcmResampler::new();
        let mut sent_samples_16k = 0u64;

        for message in rx {
            match message {
                TranscriptionMessage::Samples {
                    samples,
                    sample_rate,
                } => {
                    let samples_16k = resampler.push(&samples, sample_rate);
                    if !samples_16k.is_empty() {
                        sent_samples_16k =
                            sent_samples_16k.saturating_add(samples_16k.len() as u64);
                        stream
                            .on_samples(&samples_16k)
                            .map_err(|e| format!("transcribe samples: {e}"))?;
                    }
                }
                TranscriptionMessage::Finish => break,
            }
        }

        let pending_samples = sent_samples_16k.saturating_sub(
            last_emitted_end_samples
                .load(Ordering::Relaxed)
                .min(sent_samples_16k),
        );
        if pending_samples >= MIN_FINAL_TRANSCRIPTION_SAMPLES {
            stream
                .finish()
                .map_err(|e| format!("finish transcription stream: {e}"))?;
        }
        drop(stream);
        writer
            .close()
            .map_err(|e| format!("close transcription encoder: {e}"))
    };
    result.map_err(|e| format!("transcribe audio: {e}"))
}

fn get_or_init_scribble(
    engine: &ScribbleEngine,
    paths: ModelPaths,
) -> Result<SharedScribble, String> {
    let mut guard = lock_or_recover(engine);
    if let Some(scribble) = guard.as_ref() {
        return Ok(scribble.clone());
    }

    let scribble = Scribble::new(
        [paths.model_path.to_string_lossy().to_string()],
        paths.vad_model_path.to_string_lossy(),
    )
    .map_err(|e| format!("initialize scribble: {e}"))?;
    let scribble = Arc::new(Mutex::new(scribble));
    *guard = Some(scribble.clone());
    Ok(scribble)
}

#[derive(Clone)]
struct ModelPaths {
    model_path: PathBuf,
    vad_model_path: PathBuf,
}

fn resolve_model_paths(app: &AppHandle) -> Result<ModelPaths, String> {
    let model_path = resolve_model_file_path(app, MODEL_PATH_ENV, DEFAULT_MODEL_FILE)?;
    let vad_model_path = resolve_model_file_path(app, VAD_MODEL_PATH_ENV, DEFAULT_VAD_MODEL_FILE)?;

    if !model_path.is_file() {
        return Err(format!(
            "Scribble model missing at '{}'. Set {MODEL_PATH_ENV} or place the model in app data/{MODEL_DIR}.",
            model_path.display()
        ));
    }
    if !vad_model_path.is_file() {
        return Err(format!(
            "Scribble VAD model missing at '{}'. Set {VAD_MODEL_PATH_ENV} or place the model in app data/{MODEL_DIR}.",
            vad_model_path.display()
        ));
    }

    Ok(ModelPaths {
        model_path,
        vad_model_path,
    })
}

fn resolve_model_file_path(
    app: &AppHandle,
    env_var: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os(env_var).map(PathBuf::from) {
        return Ok(path);
    }

    let bundled_path = bundled_model_path(app, file_name)?;
    if bundled_path.is_file() {
        return Ok(bundled_path);
    }

    app_model_path(app, file_name)
}

fn bundled_model_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(
            PathBuf::from(MODEL_DIR).join(file_name),
            BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve bundled model path: {e}"))
}

fn app_model_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?;
    Ok(app_data.join(MODEL_DIR).join(file_name))
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn panic_payload_message(panic: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = panic.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = panic.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic".to_string()
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct PcmResampler {
    sample_rate: Option<u32>,
    input: Vec<f32>,
    position: f64,
}

impl PcmResampler {
    fn new() -> Self {
        Self {
            sample_rate: None,
            input: Vec::new(),
            position: 0.0,
        }
    }

    fn push(&mut self, samples: &[f32], sample_rate: u32) -> Vec<f32> {
        if sample_rate == 0 || samples.is_empty() {
            return Vec::new();
        }

        if sample_rate == TARGET_SAMPLE_RATE {
            self.reset();
            return sanitize_samples(samples);
        }

        if self.sample_rate != Some(sample_rate) {
            self.reset();
            self.sample_rate = Some(sample_rate);
        }

        self.input.extend(samples.iter().filter_map(|sample| {
            if sample.is_finite() {
                Some(sample.clamp(-1.0, 1.0))
            } else {
                None
            }
        }));

        let mut output = Vec::new();
        let step = sample_rate as f64 / TARGET_SAMPLE_RATE as f64;
        while self.position + 1.0 < self.input.len() as f64 {
            let index = self.position.floor() as usize;
            let frac = (self.position - index as f64) as f32;
            let a = self.input[index];
            let b = self.input[index + 1];
            output.push(a + (b - a) * frac);
            self.position += step;
        }

        let consumed = (self.position.floor() as usize).min(self.input.len().saturating_sub(1));
        if consumed > 0 {
            self.input.drain(..consumed);
            self.position -= consumed as f64;
        }

        output
    }

    fn reset(&mut self) {
        self.sample_rate = None;
        self.input.clear();
        self.position = 0.0;
    }
}

fn sanitize_samples(samples: &[f32]) -> Vec<f32> {
    samples
        .iter()
        .filter_map(|sample| {
            if sample.is_finite() {
                Some(sample.clamp(-1.0, 1.0))
            } else {
                None
            }
        })
        .collect()
}

struct TranscriptionEventWriter {
    app: AppHandle,
    session_id: String,
    element_id: String,
    last_emitted_end_samples: Arc<AtomicU64>,
}

impl TranscriptionEventWriter {
    fn new(
        app: AppHandle,
        session_id: String,
        element_id: String,
        last_emitted_end_samples: Arc<AtomicU64>,
    ) -> Self {
        Self {
            app,
            session_id,
            element_id,
            last_emitted_end_samples,
        }
    }
}

impl SegmentEncoder for TranscriptionEventWriter {
    fn write_segment(&mut self, segment: &Segment) -> scribble::Result<()> {
        self.last_emitted_end_samples.fetch_max(
            seconds_to_sample_index(segment.end_seconds),
            Ordering::Relaxed,
        );
        let _ = self.app.emit(
            SEGMENT_EVENT,
            AudioTranscriptionSegmentPayload {
                session_id: self.session_id.clone(),
                element_id: self.element_id.clone(),
                text: segment.text.clone(),
                start_seconds: segment.start_seconds,
                end_seconds: segment.end_seconds,
                language_code: segment.language_code.clone(),
            },
        );
        Ok(())
    }

    fn close(&mut self) -> scribble::Result<()> {
        Ok(())
    }
}

fn seconds_to_sample_index(seconds: f32) -> u64 {
    if !seconds.is_finite() || seconds <= 0.0 {
        return 0;
    }
    (seconds * TARGET_SAMPLE_RATE as f32).round() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm_resampler_sanitizes_target_rate_samples() {
        let mut resampler = PcmResampler::new();
        let samples = resampler.push(&[0.5, f32::NAN, 2.0, -2.0], TARGET_SAMPLE_RATE);

        assert_eq!(samples, vec![0.5, 1.0, -1.0]);
    }

    #[test]
    fn pcm_resampler_downsamples_continuous_chunks() {
        let mut resampler = PcmResampler::new();
        let first = resampler.push(&[0.0, 0.25, 0.5], 32_000);
        let second = resampler.push(&[0.75, 1.0], 32_000);

        assert_eq!(first, vec![0.0]);
        assert_eq!(second, vec![0.5]);
    }
}
