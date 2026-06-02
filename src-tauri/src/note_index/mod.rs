//! Background note-content index engine.
//!
//! Owns the provider registry, per-node debounce, bounded-concurrency execution,
//! staleness hashing, on-disk artifacts, and the `index-updated` event. The
//! frontend is a thin client: it triggers reindex (passing the node's id, file
//! path, and type), listens for `index-updated`, and reads the artifacts.

mod extract;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;

/// Bump to invalidate every artifact when the extraction format changes.
const SCHEMA_VERSION: u32 = 1;
const INDEX_DIR: &str = "NoteIndex";
const DEBOUNCE_MS: u64 = 800;
const MAX_CONCURRENCY: usize = 2;

pub trait IndexProvider: Send + Sync {
    fn kind(&self) -> &'static str;
    fn applies_to(&self, file_type: &str) -> bool;
    fn build(&self, bytes: &[u8]) -> Result<String, String>;
}

struct NoteTextProvider;

impl IndexProvider for NoteTextProvider {
    fn kind(&self) -> &'static str {
        "note-text"
    }
    fn applies_to(&self, file_type: &str) -> bool {
        file_type == "mcanvas"
    }
    fn build(&self, bytes: &[u8]) -> Result<String, String> {
        extract::extract_note_text(bytes)
    }
}

/// On-disk index artifact for one node, read by the TS client. Holds the
/// combined text of every applicable provider (typed text now, OCR later).
/// `source_hash` is over the note bytes, so any edit reindexes; bump
/// `SCHEMA_VERSION` when the set of providers or their output changes.
/// Cross-language contract — keep in sync with `src/lib/note-index/cache.ts`.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteIndexRecord {
    node_id: String,
    source_hash: String,
    schema_version: u32,
    text: String,
    updated_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexUpdatedPayload {
    node_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReindexItem {
    node_id: String,
    path: String,
    file_type: String,
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
            providers: Arc::new(vec![Box::new(NoteTextProvider)]),
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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn index_path(app: &AppHandle, node_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("resolve cache dir: {e}"))?;
    Ok(dir.join(INDEX_DIR).join(format!("{node_id}.json")))
}

/// The heavy synchronous unit of work: read the note once, then run every
/// applicable provider, each with its own staleness check and artifact file.
/// Returns `true` if any provider's artifact was (re)written.
fn process_node(
    providers: &[Box<dyn IndexProvider>],
    node_id: &str,
    path: &str,
    file_type: &str,
    index_file: &Path,
) -> Result<bool, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let source_hash = format!("{:x}", hasher.finalize());

    if let Ok(existing) = std::fs::read(index_file) {
        if let Ok(record) = serde_json::from_slice::<NoteIndexRecord>(&existing) {
            if record.source_hash == source_hash && record.schema_version == SCHEMA_VERSION {
                return Ok(false);
            }
        }
    }

    // Run every applicable provider in turn, combining their text. A provider
    // that fails (e.g. a flaky OCR pass later) is logged and skipped, never
    // aborting the others.
    let mut parts: Vec<String> = Vec::new();
    for provider in providers.iter().filter(|p| p.applies_to(file_type)) {
        match provider.build(&bytes) {
            Ok(text) if !text.is_empty() => parts.push(text),
            Ok(_) => {}
            Err(e) => eprintln!(
                "note_index: provider {} failed for {node_id}: {e}",
                provider.kind()
            ),
        }
    }

    let record = NoteIndexRecord {
        node_id: node_id.to_string(),
        source_hash,
        schema_version: SCHEMA_VERSION,
        text: parts.join("\n\n"),
        updated_at: now_ms(),
    };

    if let Some(parent) = index_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create index dir: {e}"))?;
    }
    let json = serde_json::to_vec(&record).map_err(|e| format!("serialize index: {e}"))?;
    std::fs::write(index_file, json).map_err(|e| format!("write index: {e}"))?;
    Ok(true)
}

fn schedule(
    app: AppHandle,
    state: &IndexEngineState,
    node_id: String,
    path: String,
    file_type: String,
    debounce_ms: u64,
) {
    let providers = state.providers.clone();
    let pending = state.pending.clone();
    let semaphore = state.semaphore.clone();

    let generation = {
        let mut guard = pending.lock().unwrap();
        let counter = guard.entry(node_id.clone()).or_insert(0);
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
            if guard.get(&node_id) != Some(&generation) {
                return;
            }
        }

        let _permit = match semaphore.acquire().await {
            Ok(permit) => permit,
            Err(_) => return,
        };

        let index_file = match index_path(&app, &node_id) {
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
            if guard.get(&node_id) == Some(&generation) {
                guard.remove(&node_id);
            }
        }

        match result {
            Ok(Ok(true)) => {
                let _ = app.emit(
                    "index-updated",
                    IndexUpdatedPayload {
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

#[tauri::command]
pub fn reindex_note(
    app: AppHandle,
    state: State<'_, IndexEngineState>,
    node_id: String,
    path: String,
    file_type: String,
) {
    schedule(app, &state, node_id, path, file_type, DEBOUNCE_MS);
}

#[tauri::command]
pub fn reindex_batch(app: AppHandle, state: State<'_, IndexEngineState>, items: Vec<ReindexItem>) {
    for item in items {
        schedule(
            app.clone(),
            &state,
            item.node_id,
            item.path,
            item.file_type,
            0,
        );
    }
}

#[tauri::command]
pub fn remove_index(app: AppHandle, node_id: String) -> Result<(), String> {
    let path = index_path(&app, &node_id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove index: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DummyProvider;
    impl IndexProvider for DummyProvider {
        fn kind(&self) -> &'static str {
            "dummy"
        }
        fn applies_to(&self, file_type: &str) -> bool {
            file_type == "mcanvas"
        }
        fn build(&self, _bytes: &[u8]) -> Result<String, String> {
            Ok("dummy index text".into())
        }
    }

    struct FailingProvider;
    impl IndexProvider for FailingProvider {
        fn kind(&self) -> &'static str {
            "failing"
        }
        fn applies_to(&self, file_type: &str) -> bool {
            file_type == "mcanvas"
        }
        fn build(&self, _bytes: &[u8]) -> Result<String, String> {
            Err("boom".into())
        }
    }

    fn read_text(index_file: &Path) -> String {
        let bytes = std::fs::read(index_file).unwrap();
        let record: NoteIndexRecord = serde_json::from_slice(&bytes).unwrap();
        record.text
    }

    #[test]
    fn combines_every_applicable_provider_then_skips_when_fresh() {
        let base = std::env::temp_dir().join("note_index_multi_provider_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let note_path = base.join("note.myelin");
        std::fs::write(&note_path, include_bytes!("test_fixture.bin")).unwrap();
        let index_file = base.join("idx").join("node1.json");

        let providers: Vec<Box<dyn IndexProvider>> =
            vec![Box::new(NoteTextProvider), Box::new(DummyProvider)];
        let path = note_path.to_str().unwrap();

        // First run: one file holds the combined text of both providers.
        let changed = process_node(&providers, "node1", path, "mcanvas", &index_file).unwrap();
        assert!(changed);
        let text = read_text(&index_file);
        assert!(text.contains("Indexed Heading Title"));
        assert!(text.contains("dummy index text"));

        // Second run: the file is fresh, so nothing is rewritten.
        let changed_again =
            process_node(&providers, "node1", path, "mcanvas", &index_file).unwrap();
        assert!(!changed_again);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn a_failing_provider_does_not_block_the_others() {
        let base = std::env::temp_dir().join("note_index_failing_provider_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let note_path = base.join("note.myelin");
        std::fs::write(&note_path, include_bytes!("test_fixture.bin")).unwrap();
        let index_file = base.join("idx").join("node1.json");

        // Failing provider runs first; it must not abort the one after it.
        let providers: Vec<Box<dyn IndexProvider>> =
            vec![Box::new(FailingProvider), Box::new(NoteTextProvider)];
        let path = note_path.to_str().unwrap();

        let changed = process_node(&providers, "node1", path, "mcanvas", &index_file).unwrap();
        assert!(changed);
        assert!(read_text(&index_file).contains("Indexed Heading Title"));

        std::fs::remove_dir_all(&base).ok();
    }
}
