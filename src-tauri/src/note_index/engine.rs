use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

use super::providers::{default_providers, IndexProvider};
use super::store::{index_path, process_node};

const MAX_CONCURRENCY: usize = 2;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexUpdatedPayload {
    repo_id: String,
    node_id: String,
}

pub struct IndexEngineState {
    providers: Arc<Vec<Box<dyn IndexProvider>>>,
    /// node id -> latest scheduled generation, for debounce + coalescing.
    pending: Arc<Mutex<HashMap<String, u64>>>,
    semaphore: Arc<Semaphore>,
}

impl IndexEngineState {
    pub fn new() -> Self {
        Self {
            providers: Arc::new(default_providers()),
            pending: Arc::new(Mutex::new(HashMap::new())),
            semaphore: Arc::new(Semaphore::new(MAX_CONCURRENCY)),
        }
    }
}

impl Default for IndexEngineState {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn schedule(
    app: AppHandle,
    state: &IndexEngineState,
    repo_id: String,
    node_id: String,
    path: String,
    file_type: String,
    debounce_ms: u64,
) {
    let providers = state.providers.clone();
    let pending = state.pending.clone();
    let semaphore = state.semaphore.clone();

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

        let index_file = match index_path(&app, &repo_id, &node_id) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("note_index: {e}");
                return;
            }
        };

        let work_node = node_id.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            process_node(&providers, &work_node, &path, &file_type, &index_file)
        })
        .await;

        {
            let mut guard = pending.lock().unwrap();
            if guard.get(&pending_key) == Some(&generation) {
                guard.remove(&pending_key);
            }
        }

        match result {
            Ok(Ok(true)) => {
                let _ = app.emit(
                    "index-updated",
                    IndexUpdatedPayload {
                        repo_id: repo_id.clone(),
                        node_id: node_id.clone(),
                    },
                );
            }
            Ok(Ok(false)) => {}
            Ok(Err(e)) => eprintln!("note_index: build failed for {node_id}: {e}"),
            Err(e) => eprintln!("note_index: task panicked for {node_id}: {e}"),
        }
    });
}
