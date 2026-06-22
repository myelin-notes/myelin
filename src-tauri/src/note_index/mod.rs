//! Background note-content index engine.
//!
//! Owns the provider registry, per-node debounce, bounded-concurrency execution,
//! staleness hashing, on-disk artifacts, and the `index-updated` event. The
//! frontend is a thin client: it triggers reindex (passing the node's id, file
//! path, and type), listens for `index-updated`, and reads the artifacts.

mod engine;
mod providers;
mod semantic;
mod store;

use serde::Deserialize;
use tauri::{AppHandle, State};

pub use engine::IndexEngineState;

use engine::schedule;
use semantic::SemanticEmbedding;
use store::index_path;

const DEBOUNCE_MS: u64 = 800;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReindexItem {
    node_id: String,
    path: String,
    file_type: String,
}

#[tauri::command]
pub fn reindex_note(
    app: AppHandle,
    state: State<'_, IndexEngineState>,
    repo_id: String,
    node_id: String,
    path: String,
    file_type: String,
) {
    schedule(app, &state, repo_id, node_id, path, file_type, DEBOUNCE_MS);
}

#[tauri::command]
pub fn reindex_batch(
    app: AppHandle,
    state: State<'_, IndexEngineState>,
    repo_id: String,
    items: Vec<ReindexItem>,
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
pub fn remove_index(app: AppHandle, repo_id: String, node_id: String) -> Result<(), String> {
    let path = index_path(&app, &repo_id, &node_id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove index: {e}")),
    }
}

#[tauri::command]
pub async fn embed_search_query(
    app: AppHandle,
    state: State<'_, IndexEngineState>,
    query: String,
) -> Result<SemanticEmbedding, String> {
    let semantic = state.semantic_model_handle();
    tauri::async_runtime::spawn_blocking(move || semantic.embed_query(&app, query.trim()))
        .await
        .map_err(|e| format!("semantic query task panicked: {e}"))?
}
