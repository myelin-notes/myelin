use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use scribble::{
    Backend, BackendStream, Opts, OutputType, Scribble, Segment, SegmentEncoder, WhisperBackend,
};
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};

const MODEL_DIR: &str = "scribble-models";
const DEFAULT_MODEL_FILE: &str = "ggml-base.bin";
const VAD_STUB_FILE: &str = "scribble-vad-stub.bin";
const SEGMENT_EVENT: &str = "audio-transcription-segment";
const FINISHED_EVENT: &str = "audio-transcription-finished";
const TARGET_SAMPLE_RATE: u32 = 16_000;
/// A live session pushes samples roughly every 85 ms, so a receiver that stays
/// quiet this long means the frontend abandoned the session (reload, crash).
const SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(10);

type SampleSender = mpsc::SyncSender<TranscriptionMessage>;
type Sessions = Arc<Mutex<HashMap<String, SampleSender>>>;
type SharedScribble = Arc<Scribble<WhisperBackend>>;
type ScribbleEngine = Arc<Mutex<Option<SharedScribble>>>;

enum TranscriptionMessage {
    Samples { samples: Vec<f32>, sample_rate: u32 },
    Finish,
}

pub struct TranscriptionState {
    sessions: Sessions,
    engine: ScribbleEngine,
}

impl TranscriptionState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            engine: Arc::new(Mutex::new(None)),
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
    text: String,
    start_seconds: f32,
    end_seconds: f32,
    language_code: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioTranscriptionFinishedPayload {
    session_id: String,
    error: Option<String>,
}

#[tauri::command(async)]
pub fn start_audio_transcription(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    session_id: String,
) -> Result<(), String> {
    let paths = resolve_model_paths(&app)?;
    let (tx, rx) = mpsc::sync_channel::<TranscriptionMessage>(64);

    {
        let mut sessions = state.sessions.lock().expect("sessions mutex poisoned");
        sessions.insert(session_id.clone(), tx);
    }

    let sessions = state.sessions.clone();
    let engine = state.engine.clone();
    std::thread::spawn(move || {
        let result = catch_unwind(AssertUnwindSafe(|| {
            run_transcription_session(app.clone(), engine.clone(), paths, session_id.clone(), rx)
        }))
        .unwrap_or_else(|panic| {
            // The panic may have corrupted the cached engine and poisoned its
            // mutex; drop it so the next session re-initializes from scratch.
            *engine
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
            Err(format!(
                "transcription worker panicked: {}",
                panic_payload_message(panic)
            ))
        });

        {
            let mut sessions = sessions.lock().expect("sessions mutex poisoned");
            sessions.remove(&session_id);
            // Reclaim the cached engine (~200MB resident) once no session
            // needs it. The next recording reloads the model; that latency is
            // absorbed by the sample channel's buffering. Holding the
            // sessions lock means a session starting right now re-initializes
            // only after the clear.
            if sessions.is_empty() {
                *engine
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
            }
        }

        let error = result.err();
        let _ = app.emit(
            FINISHED_EVENT,
            AudioTranscriptionFinishedPayload { session_id, error },
        );
    });

    Ok(())
}

/// Accepts a raw little-endian f32 PCM payload. Returns `Ok(false)` when the
/// session is gone (finished or abandoned) — a benign condition the frontend
/// treats as end-of-stream rather than an error.
#[tauri::command(async)]
pub fn push_audio_transcription_samples(
    state: State<'_, TranscriptionState>,
    request: Request<'_>,
) -> Result<bool, String> {
    let session_id = header_string(&request, "x-session-id")?;
    let sample_rate: u32 = header_string(&request, "x-sample-rate")?
        .parse()
        .map_err(|e| format!("invalid x-sample-rate header: {e}"))?;
    let samples: Vec<f32> = match request.body() {
        // The raw body is not guaranteed 4-byte aligned, so decode bytewise.
        InvokeBody::Raw(bytes) => bytes
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
            .collect(),
        InvokeBody::Json(_) => return Err("expected raw PCM sample payload".to_string()),
    };

    let tx = {
        let sessions = state.sessions.lock().expect("sessions mutex poisoned");
        sessions.get(&session_id).cloned()
    };
    let Some(tx) = tx else {
        return Ok(false);
    };

    let message = TranscriptionMessage::Samples {
        samples,
        sample_rate,
    };
    if tx.send(message).is_ok() {
        return Ok(true);
    }

    let mut sessions = state.sessions.lock().expect("sessions mutex poisoned");
    sessions.remove(&session_id);
    Ok(false)
}

#[tauri::command(async)]
pub fn finish_audio_transcription(
    state: State<'_, TranscriptionState>,
    session_id: String,
) -> Result<(), String> {
    let tx = {
        let sessions = state.sessions.lock().expect("sessions mutex poisoned");
        sessions.get(&session_id).cloned()
    };
    if let Some(tx) = tx {
        if tx.try_send(TranscriptionMessage::Finish).is_err() {
            let mut sessions = state.sessions.lock().expect("sessions mutex poisoned");
            sessions.remove(&session_id);
        }
    }
    Ok(())
}

fn header_string(request: &Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
        .ok_or_else(|| format!("missing {name} header"))
}

fn run_transcription_session(
    app: AppHandle,
    engine: ScribbleEngine,
    paths: ModelPaths,
    session_id: String,
    rx: mpsc::Receiver<TranscriptionMessage>,
) -> Result<(), String> {
    let scribble = get_or_init_scribble(&engine, paths)?;
    let opts = Opts {
        model_key: None,
        enable_translate_to_english: false,
        // Scribble's streaming path ignores this flag; VAD is unused, so the
        // "VAD model" we hand Scribble::new is an empty stub (see resolve_model_paths).
        enable_voice_activity_detection: false,
        language: None,
        output_type: OutputType::Json,
        incremental_min_window_seconds: 1,
    };

    let mut writer = TranscriptionEventWriter::new(app, session_id);
    let mut stream = scribble
        .backend()
        .create_stream(&opts, &mut writer)
        .map_err(|e| format!("create scribble stream: {e}"))?;
    let mut resampler = PcmResampler::new();

    // An explicit Finish, a timeout, and a disconnect all end the session.
    while let Ok(TranscriptionMessage::Samples {
        samples,
        sample_rate,
    }) = rx.recv_timeout(SESSION_IDLE_TIMEOUT)
    {
        let samples_16k = resampler.push(&samples, sample_rate);
        if !samples_16k.is_empty() {
            stream
                .on_samples(&samples_16k)
                .map_err(|e| format!("transcribe samples: {e}"))?;
        }
    }

    // Always flush: this is what emits the final in-progress segment. Whisper
    // handles short tails itself (input under 100ms yields zero segments).
    stream
        .finish()
        .map_err(|e| format!("finish transcription stream: {e}"))?;
    drop(stream);
    writer
        .close()
        .map_err(|e| format!("close transcription encoder: {e}"))
}

fn get_or_init_scribble(
    engine: &ScribbleEngine,
    paths: ModelPaths,
) -> Result<SharedScribble, String> {
    // A previous worker panic can leave the mutex poisoned even after the
    // panic path resets the value to None, so recover the (valid) inner state.
    let mut guard = engine
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(scribble) = guard.as_ref() {
        return Ok(scribble.clone());
    }

    let scribble = Scribble::new(
        [paths.model_path.to_string_lossy().to_string()],
        paths.vad_model_path.to_string_lossy(),
    )
    .map_err(|e| format!("initialize scribble: {e}"))?;
    let scribble = Arc::new(scribble);
    *guard = Some(scribble.clone());
    Ok(scribble)
}

#[derive(Clone)]
struct ModelPaths {
    model_path: PathBuf,
    vad_model_path: PathBuf,
}

fn resolve_model_paths(app: &AppHandle) -> Result<ModelPaths, String> {
    let model_path = bundled_model_path(app, DEFAULT_MODEL_FILE)?;

    if !model_path.is_file() {
        return Err(format!(
            "Bundled scribble model missing at '{}' — check that resources/{MODEL_DIR} is present (git lfs pull).",
            model_path.display()
        ));
    }

    // Scribble 0.5.4 requires the VAD model path to point at an existing file
    // even though the streaming path never loads it (VAD only applies to its
    // transcribe() pipeline, which we don't use). Hand it an empty stub
    // instead of bundling the real silero model.
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("resolve app local data dir: {e}"))?;
    let vad_model_path = data_dir.join(VAD_STUB_FILE);
    if !vad_model_path.is_file() {
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("create app local data dir: {e}"))?;
        std::fs::write(&vad_model_path, [])
            .map_err(|e| format!("create VAD stub file: {e}"))?;
    }

    Ok(ModelPaths {
        model_path,
        vad_model_path,
    })
}

fn bundled_model_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(
            PathBuf::from(MODEL_DIR).join(file_name),
            BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve bundled model path: {e}"))
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

/// Linear-interpolation resampler to whisper's 16kHz. No anti-aliasing
/// filter: content above 8kHz aliases into the band on 48k→16k mic input,
/// but speech energy up there is negligible and whisper is robust to it.
/// Chosen over rubato (already in-tree via scribble) because rubato's
/// fixed-chunk API would still need this buffering layer on top.
struct PcmResampler {
    input: Vec<f32>,
    position: f64,
}

impl PcmResampler {
    fn new() -> Self {
        Self {
            input: Vec::new(),
            position: 0.0,
        }
    }

    fn push(&mut self, samples: &[f32], sample_rate: u32) -> Vec<f32> {
        if samples.is_empty() {
            return Vec::new();
        }

        if sample_rate == TARGET_SAMPLE_RATE {
            return samples
                .iter()
                .copied()
                .filter_map(sanitize_sample)
                .collect();
        }

        self.input
            .extend(samples.iter().copied().filter_map(sanitize_sample));

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
}

fn sanitize_sample(sample: f32) -> Option<f32> {
    if sample.is_finite() {
        Some(sample.clamp(-1.0, 1.0))
    } else {
        None
    }
}

struct TranscriptionEventWriter {
    app: AppHandle,
    session_id: String,
}

impl TranscriptionEventWriter {
    fn new(app: AppHandle, session_id: String) -> Self {
        Self { app, session_id }
    }
}

impl SegmentEncoder for TranscriptionEventWriter {
    fn write_segment(&mut self, segment: &Segment) -> scribble::Result<()> {
        let _ = self.app.emit(
            SEGMENT_EVENT,
            AudioTranscriptionSegmentPayload {
                session_id: self.session_id.clone(),
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
