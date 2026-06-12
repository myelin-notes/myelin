use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::providers::{sha256_hex, IndexProvider, IndexSource};
use super::semantic::{is_current_embedding, SemanticEmbedding};

/// Bump to invalidate every artifact when the extraction format changes.
const SCHEMA_VERSION: u32 = 4;
const INDEX_DIR: &str = "NoteIndex";

/// One provider's contribution to a node's artifact.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderEntry {
    kind: String,
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
    embedding: Option<SemanticEmbedding>,
    providers: Vec<ProviderEntry>,
    updated_at: u64,
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
pub(crate) fn index_path(app: &AppHandle, repo_id: &str, node_id: &str) -> Result<PathBuf, String> {
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
/// applicable provider over it. Returns `true` if the node's combined text
/// actually changed.
pub(crate) fn process_node(
    providers: &[Box<dyn IndexProvider>],
    node_id: &str,
    path: &str,
    file_type: &str,
    index_file: &Path,
    mut embedding_builder: Option<&mut dyn FnMut(&str) -> Result<SemanticEmbedding, String>>,
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

    // Identical bytes: no provider's input can have changed. Still retry when
    // a text-bearing record is missing the current semantic vector.
    if let Some(record) = &existing {
        let has_current_embedding = record.embedding.as_ref().is_some_and(is_current_embedding);
        if record.source_hash == source_hash && (record.text.is_empty() || has_current_embedding) {
            return Ok(false);
        }
    }

    // A provider that fails is logged and keeps its previous entry, never
    // aborting the others.
    let source = IndexSource::new(&bytes);
    let mut entries: Vec<ProviderEntry> = Vec::new();
    for provider in applicable {
        let kind = provider.kind();
        match provider.build(&source) {
            Ok(text) => entries.push(ProviderEntry {
                kind: kind.to_string(),
                text,
            }),
            Err(e) => {
                eprintln!("note_index: provider {kind} failed for {node_id}: {e}");
                let previous = existing
                    .as_ref()
                    .and_then(|record| record.providers.iter().find(|e| e.kind == kind));
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
    let previous_embedding = existing
        .as_ref()
        .and_then(|record| record.embedding.as_ref())
        .filter(|embedding| is_current_embedding(embedding))
        .cloned();
    let embedding = build_embedding(
        &text,
        previous_embedding,
        existing.as_ref(),
        &mut embedding_builder,
    );
    let changed = existing
        .as_ref()
        .is_none_or(|record| record.text != text || record.embedding != embedding);

    let record = NoteIndexRecord {
        node_id: node_id.to_string(),
        source_hash,
        schema_version: SCHEMA_VERSION,
        text,
        embedding,
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

fn build_embedding(
    text: &str,
    previous_embedding: Option<SemanticEmbedding>,
    existing: Option<&NoteIndexRecord>,
    embedding_builder: &mut Option<&mut dyn FnMut(&str) -> Result<SemanticEmbedding, String>>,
) -> Option<SemanticEmbedding> {
    if text.is_empty() {
        return None;
    }

    if existing.is_some_and(|record| record.text == text) {
        if let Some(embedding) = previous_embedding {
            return Some(embedding);
        }
    }

    let Some(build) = embedding_builder.as_mut() else {
        return None;
    };
    match build(text) {
        Ok(embedding) => Some(embedding),
        Err(e) => {
            eprintln!("note_index: semantic embedding failed: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::cell::Cell;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use super::super::providers::NoteTextProvider;

    struct DummyProvider;
    impl IndexProvider for DummyProvider {
        fn kind(&self) -> &'static str {
            "dummy"
        }
        fn applies_to(&self, file_type: &str) -> bool {
            file_type == "mcanvas"
        }
        fn build(&self, _source: &IndexSource) -> Result<String, String> {
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
        fn build(&self, _source: &IndexSource) -> Result<String, String> {
            Err("boom".into())
        }
    }

    /// Constant output, counted builds.
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
        fn build(&self, _source: &IndexSource) -> Result<String, String> {
            self.builds.fetch_add(1, Ordering::SeqCst);
            Ok("counted text".into())
        }
    }

    fn read_text(index_file: &Path) -> String {
        read_record(index_file).text
    }

    fn read_record(index_file: &Path) -> NoteIndexRecord {
        let bytes = std::fs::read(index_file).unwrap();
        serde_json::from_slice(&bytes).unwrap()
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
        let changed =
            process_node(&providers, "node1", path, "mcanvas", &index_file, None).unwrap();
        assert!(changed);
        let text = read_text(&index_file);
        assert!(text.contains("Indexed Heading Title"));
        assert!(text.contains("dummy index text"));

        // Second run: the file is fresh, so nothing is rewritten.
        let changed_again =
            process_node(&providers, "node1", path, "mcanvas", &index_file, None).unwrap();
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
        let changed = process_node(&providers, "node1", path, "png", &index_file, None).unwrap();
        assert!(!changed);
        assert!(!index_file.exists());

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

        assert!(process_node(&providers, "node1", path, "mcanvas", &index_file, None).unwrap());

        // Different bytes, same provider output: the artifact refreshes its
        // source hash but no index-updated event should fire.
        std::fs::write(&note_path, []).unwrap();
        let changed =
            process_node(&providers, "node1", path, "mcanvas", &index_file, None).unwrap();
        assert!(!changed);
        assert_eq!(builds.load(Ordering::SeqCst), 2);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn retries_embedding_when_fresh_record_has_no_vector() {
        let base = std::env::temp_dir().join("note_index_add_embedding_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let note_path = base.join("note.myelin");
        std::fs::write(&note_path, b"note bytes").unwrap();
        let index_file = base.join("idx").join("node1.json");

        let providers: Vec<Box<dyn IndexProvider>> = vec![Box::new(DummyProvider)];
        let path = note_path.to_str().unwrap();

        assert!(process_node(&providers, "node1", path, "mcanvas", &index_file, None).unwrap());
        assert!(read_record(&index_file).embedding.is_none());

        let calls = Cell::new(0);
        let mut embed = |text: &str| {
            calls.set(calls.get() + 1);
            assert_eq!(text, "dummy index text");
            Ok(SemanticEmbedding {
                model: super::super::semantic::SEMANTIC_MODEL_ID.to_string(),
                dim: super::super::semantic::SEMANTIC_DIM,
                vector: vec![0.25; super::super::semantic::SEMANTIC_DIM],
            })
        };
        let changed = process_node(
            &providers,
            "node1",
            path,
            "mcanvas",
            &index_file,
            Some(&mut embed),
        )
        .unwrap();

        assert!(changed);
        assert_eq!(calls.get(), 1);
        let record = read_record(&index_file);
        assert_eq!(record.embedding.as_ref().map(|e| e.vector.len()), Some(384));

        let changed_again = process_node(
            &providers,
            "node1",
            path,
            "mcanvas",
            &index_file,
            Some(&mut embed),
        )
        .unwrap();
        assert!(!changed_again);
        assert_eq!(calls.get(), 1);

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

        let changed =
            process_node(&providers, "node1", path, "mcanvas", &index_file, None).unwrap();
        assert!(changed);
        assert!(read_text(&index_file).contains("Indexed Heading Title"));

        std::fs::remove_dir_all(&base).ok();
    }
}
