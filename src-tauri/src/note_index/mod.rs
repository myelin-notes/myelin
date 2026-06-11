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
const SCHEMA_VERSION: u32 = 3;
const INDEX_DIR: &str = "NoteIndex";
const DEBOUNCE_MS: u64 = 800;
const MAX_CONCURRENCY: usize = 2;

pub trait IndexProvider: Send + Sync {
    fn kind(&self) -> &'static str;
    fn applies_to(&self, file_type: &str) -> bool;
    /// Cheap digest of the provider-relevant slice of the source bytes.
    /// `build` re-runs only when this changes, so an edit elsewhere in the
    /// same file (e.g. typing text) doesn't re-run unrelated derivations.
    /// Cheap extractors may hash their own output; expensive ones (OCR
    /// later) should hash their source media bytes instead.
    fn fingerprint(&self, bytes: &[u8]) -> Result<String, String>;
    fn build(&self, bytes: &[u8]) -> Result<String, String>;
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

struct NoteTextProvider;

impl IndexProvider for NoteTextProvider {
    fn kind(&self) -> &'static str {
        "note-text"
    }
    fn applies_to(&self, file_type: &str) -> bool {
        file_type == "mcanvas"
    }
    fn fingerprint(&self, bytes: &[u8]) -> Result<String, String> {
        self.build(bytes).map(|text| sha256_hex(text.as_bytes()))
    }
    fn build(&self, bytes: &[u8]) -> Result<String, String> {
        extract::extract_note_text(bytes)
    }
}

/// Whisper transcripts are generated at capture time and persisted on the
/// AUDIO element; this provider only pulls them out of the note bytes.
struct AudioTranscriptProvider;

impl IndexProvider for AudioTranscriptProvider {
    fn kind(&self) -> &'static str {
        "audio-transcript"
    }
    fn applies_to(&self, file_type: &str) -> bool {
        file_type == "mcanvas"
    }
    fn fingerprint(&self, bytes: &[u8]) -> Result<String, String> {
        self.build(bytes).map(|text| sha256_hex(text.as_bytes()))
    }
    fn build(&self, bytes: &[u8]) -> Result<String, String> {
        extract::extract_audio_transcripts(bytes)
    }
}

/// One provider's contribution to a node's artifact. `fingerprint` is the
/// provider's digest of its relevant source content; while it matches, the
/// stored `text` is reused without re-running `build`.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderEntry {
    kind: String,
    fingerprint: String,
    text: String,
}

/// On-disk index artifact for one node, read by the TS client. `text` is the
/// combined output of every applicable provider; `providers` holds the
/// per-provider entries it was assembled from. `source_hash` is over the note
/// bytes and short-circuits unchanged files; bump `SCHEMA_VERSION` when the
/// set of providers or their output changes.
/// Cross-language contract — keep in sync with `src/lib/note-index/cache.ts`.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteIndexRecord {
    node_id: String,
    source_hash: String,
    schema_version: u32,
    text: String,
    providers: Vec<ProviderEntry>,
    updated_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexUpdatedPayload {
    repo_id: String,
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
            providers: Arc::new(vec![
                Box::new(NoteTextProvider),
                Box::new(AudioTranscriptProvider),
            ]),
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

/// Reject path components that could escape the cache dir. Both `repo_id` and
/// `node_id` are frontend-derived and get joined into the index path.
fn validate_path_component(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.contains('/')
        || value.contains('\\')
        || value == "."
        || value == ".."
    {
        return Err(format!("invalid {label}: {value}"));
    }
    Ok(())
}

/// Index artifacts are namespaced per repository: `NoteIndex/<repo_id>/<node_id>.json`.
fn index_path(app: &AppHandle, repo_id: &str, node_id: &str) -> Result<PathBuf, String> {
    validate_path_component("repo id", repo_id)?;
    validate_path_component("node id", node_id)?;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("resolve cache dir: {e}"))?;
    Ok(dir
        .join(INDEX_DIR)
        .join(repo_id)
        .join(format!("{node_id}.json")))
}

/// The heavy synchronous unit of work: read the note once, then run every
/// applicable provider, each with its own per-fingerprint staleness check.
/// Returns `true` if the node's combined text actually changed.
fn process_node(
    providers: &[Box<dyn IndexProvider>],
    node_id: &str,
    path: &str,
    file_type: &str,
    index_file: &Path,
) -> Result<bool, String> {
    // The engine is the single authority on which file types are indexable.
    // If no provider handles this type, do no work and write no artifact — the
    // frontend offers every non-system file, so non-indexable types land here.
    let applicable: Vec<&dyn IndexProvider> = providers
        .iter()
        .map(Box::as_ref)
        .filter(|p| p.applies_to(file_type))
        .collect();
    if applicable.is_empty() {
        return Ok(false);
    }

    let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    let source_hash = sha256_hex(&bytes);

    let existing: Option<NoteIndexRecord> = std::fs::read(index_file)
        .ok()
        .and_then(|json| serde_json::from_slice(&json).ok())
        .filter(|record: &NoteIndexRecord| record.schema_version == SCHEMA_VERSION);

    // Identical bytes: no provider's input can have changed.
    if let Some(record) = &existing {
        if record.source_hash == source_hash {
            return Ok(false);
        }
    }

    // Re-run only the providers whose fingerprint changed; the rest reuse
    // their stored text. A provider that fails (e.g. a flaky OCR pass later)
    // is logged and keeps its previous entry, never aborting the others.
    let mut entries: Vec<ProviderEntry> = Vec::new();
    for provider in applicable {
        let kind = provider.kind();
        let previous = existing
            .as_ref()
            .and_then(|record| record.providers.iter().find(|e| e.kind == kind));

        let fresh = provider.fingerprint(&bytes).and_then(|fingerprint| {
            if let Some(prev) = previous {
                if prev.fingerprint == fingerprint {
                    return Ok(prev.clone());
                }
            }
            provider.build(&bytes).map(|text| ProviderEntry {
                kind: kind.to_string(),
                fingerprint,
                text,
            })
        });

        match fresh {
            Ok(entry) => entries.push(entry),
            Err(e) => {
                eprintln!("note_index: provider {kind} failed for {node_id}: {e}");
                if let Some(prev) = previous {
                    entries.push(prev.clone());
                }
            }
        }
    }

    let text = entries
        .iter()
        .map(|entry| entry.text.as_str())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let changed = existing.as_ref().is_none_or(|record| record.text != text);

    let record = NoteIndexRecord {
        node_id: node_id.to_string(),
        source_hash,
        schema_version: SCHEMA_VERSION,
        text,
        providers: entries,
        updated_at: now_ms(),
    };

    if let Some(parent) = index_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create index dir: {e}"))?;
    }
    let json = serde_json::to_vec(&record).map_err(|e| format!("serialize index: {e}"))?;
    std::fs::write(index_file, json).map_err(|e| format!("write index: {e}"))?;
    Ok(changed)
}

fn schedule(
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

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicUsize, Ordering};

    struct DummyProvider;
    impl IndexProvider for DummyProvider {
        fn kind(&self) -> &'static str {
            "dummy"
        }
        fn applies_to(&self, file_type: &str) -> bool {
            file_type == "mcanvas"
        }
        fn fingerprint(&self, _bytes: &[u8]) -> Result<String, String> {
            Ok("dummy-fp".into())
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
        fn fingerprint(&self, _bytes: &[u8]) -> Result<String, String> {
            Err("boom".into())
        }
        fn build(&self, _bytes: &[u8]) -> Result<String, String> {
            Err("boom".into())
        }
    }

    /// Constant fingerprint, counted builds — for asserting that `build` is
    /// skipped while the fingerprint is unchanged.
    struct CountingProvider {
        builds: Arc<AtomicUsize>,
    }
    impl IndexProvider for CountingProvider {
        fn kind(&self) -> &'static str {
            "counting"
        }
        fn applies_to(&self, file_type: &str) -> bool {
            file_type == "mcanvas"
        }
        fn fingerprint(&self, _bytes: &[u8]) -> Result<String, String> {
            Ok("constant-fp".into())
        }
        fn build(&self, _bytes: &[u8]) -> Result<String, String> {
            self.builds.fetch_add(1, Ordering::SeqCst);
            Ok("counted text".into())
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
    fn skips_types_no_provider_applies_to_without_writing() {
        let base = std::env::temp_dir().join("note_index_non_applicable_type_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let image_path = base.join("photo.png");
        std::fs::write(&image_path, [0u8, 1, 2, 3]).unwrap();
        let index_file = base.join("idx").join("node1.json");

        let providers: Vec<Box<dyn IndexProvider>> = vec![Box::new(NoteTextProvider)];
        let path = image_path.to_str().unwrap();

        // No provider handles "png": nothing is written and no rewrite is signalled.
        let changed = process_node(&providers, "node1", path, "png", &index_file).unwrap();
        assert!(!changed);
        assert!(!index_file.exists());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn unchanged_fingerprint_skips_rebuild_when_the_file_changes() {
        let base = std::env::temp_dir().join("note_index_fingerprint_reuse_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let note_path = base.join("note.myelin");
        std::fs::write(&note_path, include_bytes!("test_fixture.bin")).unwrap();
        let index_file = base.join("idx").join("node1.json");

        let builds = Arc::new(AtomicUsize::new(0));
        let providers: Vec<Box<dyn IndexProvider>> = vec![
            Box::new(NoteTextProvider),
            Box::new(CountingProvider {
                builds: builds.clone(),
            }),
        ];
        let path = note_path.to_str().unwrap();

        let changed = process_node(&providers, "node1", path, "mcanvas", &index_file).unwrap();
        assert!(changed);
        assert_eq!(builds.load(Ordering::SeqCst), 1);

        // The note's text content changes, but the counting provider's
        // fingerprint doesn't — its build must not re-run.
        std::fs::write(&note_path, []).unwrap();
        let changed = process_node(&providers, "node1", path, "mcanvas", &index_file).unwrap();
        assert!(changed, "note text was removed, combined text changed");
        assert_eq!(
            builds.load(Ordering::SeqCst),
            1,
            "build reused via fingerprint"
        );
        assert_eq!(read_text(&index_file), "counted text");

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn rewrite_with_identical_text_reports_unchanged() {
        let base = std::env::temp_dir().join("note_index_unchanged_text_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let note_path = base.join("note.myelin");
        std::fs::write(&note_path, include_bytes!("test_fixture.bin")).unwrap();
        let index_file = base.join("idx").join("node1.json");

        let builds = Arc::new(AtomicUsize::new(0));
        let providers: Vec<Box<dyn IndexProvider>> = vec![Box::new(CountingProvider {
            builds: builds.clone(),
        })];
        let path = note_path.to_str().unwrap();

        assert!(process_node(&providers, "node1", path, "mcanvas", &index_file).unwrap());

        // Different bytes, same provider output: the artifact refreshes its
        // source hash but no index-updated event should fire.
        std::fs::write(&note_path, []).unwrap();
        let changed = process_node(&providers, "node1", path, "mcanvas", &index_file).unwrap();
        assert!(!changed);
        assert_eq!(builds.load(Ordering::SeqCst), 1);

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
