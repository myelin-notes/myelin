use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use yrs::updates::decoder::Decode;
use yrs::{Any, Array, Doc, GetString, Map, Out, ReadTxn, Transact, Update, XmlFragment, XmlOut};

const SCHEMA_VERSION: u32 = 1;
const INDEX_DIR: &str = "NoteTextIndex";
const TYPE_TEXT: i64 = 1;
const TYPE_PAGE_FRAME: i64 = 3;
const TYPE_AUDIO: i64 = 7;
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize)]
struct TextRecord {
    schema_version: u32,
    source_size: u64,
    source_modified_ns: u64,
    text: String,
}

fn cache_path(app: &AppHandle, repo_id: &str, node_id: &str) -> Result<PathBuf, String> {
    for (label, value) in [("repo id", repo_id), ("node id", node_id)] {
        if value.is_empty()
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        {
            return Err(format!("invalid {label}"));
        }
    }
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join(INDEX_DIR)
        .join(repo_id)
        .join(format!("{node_id}.json")))
}

fn source_stamp(path: &Path) -> Result<(u64, u64), String> {
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    let modified_ns = metadata
        .modified()
        .map_err(|error| error.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos() as u64;
    Ok((metadata.len(), modified_ns))
}

fn index_file_at(cache_file: &Path, source: &Path, force: bool) -> Result<String, String> {
    let stamp = source_stamp(source)?;
    let old = std::fs::read(&cache_file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<TextRecord>(&bytes).ok())
        .filter(|record| record.schema_version == SCHEMA_VERSION);
    if !force {
        if let Some(record) = &old {
            if (record.source_size, record.source_modified_ns) == stamp {
                return Ok(record.text.clone());
            }
        }
    }

    let bytes = std::fs::read(source).map_err(|error| error.to_string())?;
    let text = extract_text(&bytes)?;
    if source_stamp(source)? != stamp {
        return Err("note changed while indexing".into());
    }
    if old.as_ref().is_some_and(|record| {
        record.text == text && (record.source_size, record.source_modified_ns) == stamp
    }) {
        return Ok(text);
    }
    let record = TextRecord {
        schema_version: SCHEMA_VERSION,
        source_size: stamp.0,
        source_modified_ns: stamp.1,
        text: text.clone(),
    };
    if let Some(parent) = cache_file.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = cache_file.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let json = serde_json::to_vec(&record).map_err(|error| error.to_string())?;
    std::fs::write(&temporary, json).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, cache_file).map_err(|error| error.to_string())?;
    Ok(text)
}

fn index_file(
    app: AppHandle,
    repo_id: String,
    node_id: String,
    path: String,
    force: bool,
) -> Result<String, String> {
    let cache_file = cache_path(&app, &repo_id, &node_id)?;
    index_file_at(&cache_file, Path::new(&path), force)
}

fn value_i64(value: &Any) -> Option<i64> {
    match value {
        Any::BigInt(number) => Some(*number),
        Any::Number(number) => Some(*number as i64),
        _ => None,
    }
}

fn value_string(value: &Any) -> Option<&str> {
    match value {
        Any::String(text) => Some(text.as_ref()),
        _ => None,
    }
}

fn walk_xml<T: ReadTxn>(txn: &T, node: &XmlOut, output: &mut String) {
    match node {
        XmlOut::Element(element) => {
            if !output.is_empty() && !output.ends_with('\n') {
                output.push('\n');
            }
            for child in element.children(txn) {
                walk_xml(txn, &child, output);
            }
        }
        XmlOut::Text(text) => output.push_str(&text.get_string(txn)),
        XmlOut::Fragment(fragment) => {
            for child in fragment.children(txn) {
                walk_xml(txn, &child, output);
            }
        }
    }
}

fn extract_text(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Ok(String::new());
    }
    let doc = Doc::new();
    let update = Update::decode_v1(bytes).map_err(|error| error.to_string())?;
    doc.transact_mut()
        .apply_update(update)
        .map_err(|error| error.to_string())?;
    let elements = doc.get_or_insert_array("elements");
    let txn = doc.transact();
    let mut parts = Vec::new();
    for item in elements.iter(&txn) {
        let Out::YMap(element) = item else { continue };
        let kind = match element.get(&txn, "type") {
            Some(Out::Any(value)) => value_i64(&value),
            _ => None,
        };
        match kind {
            Some(TYPE_TEXT) => {
                if let Some(Out::Any(value)) = element.get(&txn, "text") {
                    if let Some(text) = value_string(&value) {
                        parts.push(text.to_owned());
                    }
                }
            }
            Some(TYPE_PAGE_FRAME) => {
                if let Some(Out::Any(value)) = element.get(&txn, "uuid") {
                    if let Some(uuid) = value_string(&value) {
                        if let Some(fragment) = txn.get_xml_fragment(format!("pf-{uuid}").as_str())
                        {
                            let mut text = String::new();
                            for child in fragment.children(&txn) {
                                walk_xml(&txn, &child, &mut text);
                            }
                            parts.push(text);
                        }
                    }
                }
            }
            Some(TYPE_AUDIO) => {
                if let Some(Out::Any(Any::Array(segments))) =
                    element.get(&txn, "transcriptSegments")
                {
                    let text = segments
                        .iter()
                        .filter_map(|entry| match entry {
                            Any::Map(fields) => fields.get("text").and_then(value_string),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join(" ");
                    parts.push(text);
                }
            }
            _ => {}
        }
    }
    Ok(parts
        .into_iter()
        .map(|part| part.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n"))
}

#[tauri::command]
pub async fn index_note_text(
    app: AppHandle,
    repo_id: String,
    node_id: String,
    path: String,
    force: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || index_file(app, repo_id, node_id, path, force))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn remove_note_text_index(
    app: AppHandle,
    repo_id: String,
    node_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = cache_path(&app, &repo_id, &node_id)?;
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Array, Map, MapPrelim, StateVector};

    #[test]
    fn extracts_canvas_text_and_transcripts() {
        let doc = Doc::new();
        let elements = doc.get_or_insert_array("elements");
        let fragment = doc.get_or_insert_xml_fragment("pf-frame");
        let mut txn = doc.transact_mut();
        let text = elements.push_back(&mut txn, MapPrelim::default());
        text.insert(&mut txn, "type", TYPE_TEXT);
        text.insert(&mut txn, "text", "standalone zebra");
        let frame = elements.push_back(&mut txn, MapPrelim::default());
        frame.insert(&mut txn, "type", TYPE_PAGE_FRAME);
        frame.insert(&mut txn, "uuid", "frame");
        let audio = elements.push_back(&mut txn, MapPrelim::default());
        audio.insert(&mut txn, "type", TYPE_AUDIO);
        audio.insert(
            &mut txn,
            "transcriptSegments",
            Any::Array(
                vec![Any::Map(std::sync::Arc::new(
                    std::collections::HashMap::from([(
                        "text".into(),
                        Any::String("spoken otter".into()),
                    )]),
                ))]
                .into(),
            ),
        );
        fragment.push_back(&mut txn, yrs::XmlTextPrelim::new("page frame fox"));
        let bytes = txn.encode_state_as_update_v1(&StateVector::default());
        drop(txn);
        let result = extract_text(&bytes).unwrap();
        assert!(result.contains("standalone zebra"));
        assert!(result.contains("page frame fox"));
        assert!(result.contains("spoken otter"));
    }

    #[test]
    fn reuses_unchanged_cache_and_rewrites_after_a_save() {
        let dir =
            std::env::temp_dir().join(format!("myelin-note-index-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("note.mcanvas");
        let cache = dir.join("cache.json");
        std::fs::write(&source, []).unwrap();

        assert_eq!(index_file_at(&cache, &source, false).unwrap(), "");
        let before = std::fs::read(&cache).unwrap();
        assert_eq!(index_file_at(&cache, &source, false).unwrap(), "");
        assert_eq!(std::fs::read(&cache).unwrap(), before);

        let doc = Doc::new();
        let elements = doc.get_or_insert_array("elements");
        let mut txn = doc.transact_mut();
        let text = elements.push_back(&mut txn, MapPrelim::default());
        text.insert(&mut txn, "type", TYPE_TEXT);
        text.insert(&mut txn, "text", "new fox");
        let bytes = txn.encode_state_as_update_v1(&StateVector::default());
        std::fs::write(&source, bytes).unwrap();
        assert_eq!(index_file_at(&cache, &source, true).unwrap(), "new fox");
        assert_ne!(std::fs::read(&cache).unwrap(), before);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
