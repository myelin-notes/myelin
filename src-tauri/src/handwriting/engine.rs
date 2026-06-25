use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

use super::store::{artifact_path, process_node, Recognizer};

/// One recognizer model: serialize inferences rather than contend on it. This
/// is deliberately separate from the note-index pool so heavy recognition never
/// blocks the text reindex that keeps search fresh.
const MAX_CONCURRENCY: usize = 1;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HandwritingUpdatedPayload {
    repo_id: String,
    node_id: String,
}

pub struct HandwritingState {
    /// node key -> latest scheduled generation, for debounce + coalescing.
    pending: Arc<Mutex<HashMap<String, u64>>>,
    semaphore: Arc<Semaphore>,
    recognizer: Arc<Recognizer>,
}

impl HandwritingState {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            semaphore: Arc::new(Semaphore::new(MAX_CONCURRENCY)),
            recognizer: Arc::new(Recognizer::new()),
        }
    }
}

impl Default for HandwritingState {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn schedule(
    app: AppHandle,
    state: &HandwritingState,
    repo_id: String,
    node_id: String,
    path: String,
    file_type: String,
    debounce_ms: u64,
) {
    // Only canvas notes can hold strokes; never spawn a worker for anything else.
    if file_type != "mcanvas" {
        return;
    }

    let pending = state.pending.clone();
    let semaphore = state.semaphore.clone();
    let recognizer = state.recognizer.clone();

    // Key by repo + node so the same note in two repos debounces independently.
    let pending_key = format!("{repo_id}/{node_id}");

    let generation = {
        let mut guard = pending.lock().unwrap();
        let counter = guard.entry(pending_key.clone()).or_insert(0);
        *counter += 1;
        *counter
    };

    tauri::async_runtime::spawn(async move {
        if debounce_ms > 0 {
            tokio::time::sleep(Duration::from_millis(debounce_ms)).await;
        }

        // Superseded by a newer request during the debounce window?
        {
            let guard = pending.lock().unwrap();
            if guard.get(&pending_key) != Some(&generation) {
                return;
            }
        }

        let _permit = match semaphore.acquire().await {
            Ok(permit) => permit,
            Err(_) => return,
        };

        // Re-check after acquiring the permit: with one worker, rapid edits
        // queue behind each other and only the latest generation is worth
        // running. Returning here leaves the pending entry for the newer
        // generation that owns it.
        {
            let guard = pending.lock().unwrap();
            if guard.get(&pending_key) != Some(&generation) {
                return;
            }
        }

        // One cleanup point for the pending entry, reached whether resolving the
        // artifact path or the recognition itself fails. (Supersede paths return
        // earlier without touching it — a newer generation owns it then.)
        let result: Result<bool, String> = match artifact_path(&app, &repo_id, &node_id) {
            Ok(artifact) => {
                let work_node = node_id.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    process_node(&work_node, &path, &file_type, &artifact, &recognizer)
                })
                .await
                .unwrap_or_else(|e| Err(format!("task panicked: {e}")))
            }
            Err(e) => Err(e),
        };

        {
            let mut guard = pending.lock().unwrap();
            if guard.get(&pending_key) == Some(&generation) {
                guard.remove(&pending_key);
            }
        }

        match result {
            Ok(true) => {
                let _ = app.emit(
                    "handwriting-updated",
                    HandwritingUpdatedPayload { repo_id, node_id },
                );
            }
            Ok(false) => {}
            Err(e) => crate::error_report::report_error(
                &app,
                "handwriting",
                &format!("recognition failed for {node_id}"),
                e,
            ),
        }
    });
}
