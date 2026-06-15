//! Background handwriting-recognition engine.
//!
//! A *separate producer* from the note index (`note_index`): it runs on its own
//! single-slot worker so heavy recognition never blocks the text reindex that
//! keeps search fresh, and it writes its own per-node artifact rather than
//! touching the index record. The frontend triggers it from the same save path
//! that triggers reindex; the actual line recognition is stubbed in `store.rs`.

mod engine;
mod store;

use tauri::{AppHandle, State};

pub use engine::HandwritingState;

use engine::schedule;
use store::artifact_path;

/// Recognition is inherently latent (it lags the pen), so debounce longer than
/// the text reindex — rapid stroke flushes coalesce into one pass.
const DEBOUNCE_MS: u64 = 1500;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizeItem {
    node_id: String,
    path: String,
    file_type: String,
}

#[tauri::command]
pub fn recognize_handwriting(
    app: AppHandle,
    state: State<'_, HandwritingState>,
    repo_id: String,
    node_id: String,
    path: String,
    file_type: String,
) {
    schedule(app, &state, repo_id, node_id, path, file_type, DEBOUNCE_MS);
}

#[tauri::command]
pub fn recognize_handwriting_batch(
    app: AppHandle,
    state: State<'_, HandwritingState>,
    repo_id: String,
    items: Vec<RecognizeItem>,
) {
    for item in items {
        schedule(
            app.clone(),
            &state,
            repo_id.clone(),
            item.node_id,
            item.path,
            item.file_type,
            0,
        );
    }
}

#[tauri::command]
pub fn remove_handwriting(app: AppHandle, repo_id: String, node_id: String) -> Result<(), String> {
    let path = artifact_path(&app, &repo_id, &node_id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove handwriting: {e}")),
    }
}
