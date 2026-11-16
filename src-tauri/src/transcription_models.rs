use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_http::reqwest::Client;
use tokio::io::AsyncWriteExt;

const BUNDLED_MODEL_ID: &str = "base";
const MODELS_DIR: &str = "transcription-models";
const PROGRESS_EVENT: &str = "transcription-model-download-progress";
// Fired however the download ended, so a settings view mounted mid-download can re-list.
const FINISHED_EVENT: &str = "transcription-model-download-finished";
const PROGRESS_STEP_BYTES: u64 = 1 << 20;
// Pinned so the hashes below keep matching what the URL serves.
const HF_REVISION: &str = "5359861c739e955e79d9a303bcbc70fb988958b1";

struct ModelSpec {
    id: &'static str,
    file: &'static str,
    sha256: &'static str,
    bytes: u64,
    /// Too slow or memory-hungry for phones.
    desktop_only: bool,
}

const DOWNLOADABLE_MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "small",
        file: "ggml-small-q5_1.bin",
        sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
        bytes: 190_085_487,
        desktop_only: false,
    },
    ModelSpec {
        id: "large-v3-turbo",
        file: "ggml-large-v3-turbo-q5_0.bin",
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        bytes: 574_041_195,
        desktop_only: true,
    },
];

#[derive(Default)]
pub struct ModelDownloads(Mutex<HashMap<&'static str, Arc<AtomicBool>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionModelInfo {
    id: &'static str,
    bytes: u64,
    /// `false` for the bundled model only, which is always present.
    downloadable: bool,
    downloaded: bool,
    downloading: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressPayload {
    id: &'static str,
    received_bytes: u64,
}

fn available_models() -> impl Iterator<Item = &'static ModelSpec> {
    DOWNLOADABLE_MODELS
        .iter()
        .filter(|spec| !(cfg!(mobile) && spec.desktop_only))
}

fn find_model(id: &str) -> Result<&'static ModelSpec, String> {
    available_models()
        .find(|spec| spec.id == id)
        .ok_or_else(|| format!("unknown transcription model '{id}'"))
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join(MODELS_DIR))
        .map_err(|e| format!("resolve app local data dir: {e}"))
}

/// `None` when `id` is the bundled model, unknown, or not downloaded — the caller falls back to bundled.
pub fn downloaded_model_path(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let spec = find_model(id).ok()?;
    let path = models_dir(app).ok()?.join(spec.file);
    path.is_file().then_some(path)
}

#[tauri::command]
pub fn list_transcription_models(
    app: AppHandle,
    downloads: State<'_, ModelDownloads>,
) -> Vec<TranscriptionModelInfo> {
    let downloading = downloads.0.lock().expect("downloads mutex poisoned");
    let bundled = TranscriptionModelInfo {
        id: BUNDLED_MODEL_ID,
        bytes: 0,
        downloadable: false,
        downloaded: true,
        downloading: false,
    };
    std::iter::once(bundled)
        .chain(available_models().map(|spec| TranscriptionModelInfo {
            id: spec.id,
            bytes: spec.bytes,
            downloadable: true,
            downloaded: downloaded_model_path(&app, spec.id).is_some(),
            downloading: downloading.contains_key(spec.id),
        }))
        .collect()
}

/// Resolves `true` once the model is in place, `false` when cancelled — the caller re-lists.
#[tauri::command]
pub async fn download_transcription_model(
    app: AppHandle,
    downloads: State<'_, ModelDownloads>,
    id: String,
) -> Result<bool, String> {
    let spec = find_model(&id)?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut map = downloads.0.lock().expect("downloads mutex poisoned");
        if map.contains_key(spec.id) {
            return Err(format!("{} is already downloading", spec.id));
        }
        map.insert(spec.id, cancelled.clone());
    }
    let result = download(&app, spec, &cancelled).await;
    downloads
        .0
        .lock()
        .expect("downloads mutex poisoned")
        .remove(spec.id);
    let _ = app.emit(FINISHED_EVENT, spec.id);
    result
}

#[tauri::command]
pub fn cancel_transcription_model_download(downloads: State<'_, ModelDownloads>, id: String) {
    if let Some(flag) = downloads
        .0
        .lock()
        .expect("downloads mutex poisoned")
        .get(id.as_str())
    {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn delete_transcription_model(app: AppHandle, id: String) -> Result<(), String> {
    let spec = find_model(&id)?;
    match std::fs::remove_file(models_dir(&app)?.join(spec.file)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("delete {}: {e}", spec.id))
        }
        _ => Ok(()),
    }
}

async fn download(
    app: &AppHandle,
    spec: &'static ModelSpec,
    cancelled: &AtomicBool,
) -> Result<bool, String> {
    let dir = models_dir(app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create models dir: {e}"))?;
    // Written beside the final path and renamed only once verified, so a crash or cancel never
    // leaves a file that downloaded_model_path would hand to whisper.
    let part = dir.join(format!("{}.part", spec.file));
    match fetch_verified(app, spec, &part, cancelled).await {
        Ok(true) => tokio::fs::rename(&part, dir.join(spec.file))
            .await
            .map(|_| true)
            .map_err(|e| format!("install {}: {e}", spec.id)),
        result => {
            let _ = tokio::fs::remove_file(&part).await;
            result
        }
    }
}

/// `Ok(false)` when cancelled.
async fn fetch_verified(
    app: &AppHandle,
    spec: &'static ModelSpec,
    destination: &Path,
    cancelled: &AtomicBool,
) -> Result<bool, String> {
    // Bounds stalls, not the transfer: a 574 MB model on a slow link takes many minutes.
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("create download client: {e}"))?;
    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/{HF_REVISION}/{}",
        spec.file
    );
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|e| format!("download {}: {e}", spec.id))?;

    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|e| format!("create {}: {e}", destination.display()))?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut last_emitted = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("download {}: {e}", spec.id))?
    {
        if cancelled.load(Ordering::Relaxed) {
            return Ok(false);
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write {}: {e}", spec.id))?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        if received - last_emitted >= PROGRESS_STEP_BYTES {
            last_emitted = received;
            let _ = app.emit(
                PROGRESS_EVENT,
                DownloadProgressPayload {
                    id: spec.id,
                    received_bytes: received,
                },
            );
        }
    }
    file.sync_all()
        .await
        .map_err(|e| format!("write {}: {e}", spec.id))?;

    if received != spec.bytes || format!("{:x}", hasher.finalize()) != spec.sha256 {
        return Err(format!("downloaded {} failed verification", spec.id));
    }
    Ok(true)
}
