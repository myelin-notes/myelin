//! Handwriting recognition artifacts: read a note's strokes, cluster them into
//! lines, and recognize each line — reusing cached recognition for lines whose
//! strokes did not move. The recognized text plus the strokes it came from are
//! persisted per node so canvas search can match handwriting and navigate to it.
//!
//! This is a *separate producer* from the note index: it runs on its own worker
//! (see `engine.rs`), writes its own artifact, and the actual line recognition
//! is the stub at the bottom of this file. Everything around the stub —
//! clustering, the per-line cache, change detection, artifact I/O — is real.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use yrs::updates::decoder::Decode;
use yrs::{Any, Array, Doc, Map, Out, Transact, Update};

/// Bump to invalidate every artifact when the clustering or segment shape
/// changes.
const SCHEMA_VERSION: u32 = 1;
const HANDWRITING_DIR: &str = "Handwriting";

/// Stroke element discriminant (mirrors `ElementType.STROKE` in the frontend).
const TYPE_STROKE: i64 = 0;

/// Strokes whose vertical centers fall within this fraction of the running line
/// height join the same line. Pure geometry, deterministic across runs, so an
/// unchanged line keeps a stable hash and skips re-recognition.
const LINE_MERGE_RATIO: f32 = 0.7;

/// One recognized line: the OCR text plus the strokes it came from (so canvas
/// search can navigate back to them). `hash` keys the per-line cache.
/// Cross-language contract — keep in sync with `src/lib/handwriting/cache.ts`.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecognizedLine {
    text: String,
    /// `[x, y, w, h]` in canvas coordinates.
    bbox: [f32; 4],
    stroke_ids: Vec<String>,
    hash: String,
}

/// On-disk handwriting artifact for one node, read by the TS client.
/// `source_hash` over the note bytes short-circuits unchanged files; the
/// per-line `hash` lets a changed note reuse recognition for unmoved lines.
/// Cross-language contract — keep in sync with `src/lib/handwriting/cache.ts`.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecognizedPage {
    node_id: String,
    source_hash: String,
    schema_version: u32,
    lines: Vec<RecognizedLine>,
    updated_at: u64,
}

/// A single handwriting stroke with its raw point buffer and bounding box.
pub(crate) struct Stroke {
    id: String,
    /// Flat `[x, y, pressure, ...]` buffer, as persisted on the stroke element.
    points: Vec<f32>,
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
}

impl Stroke {
    fn center_y(&self) -> f32 {
        (self.min_y + self.max_y) / 2.0
    }
    fn height(&self) -> f32 {
        self.max_y - self.min_y
    }
}

/// A cluster of strokes forming one text line — the unit handed to the
/// recognizer and the unit cached between runs.
pub(crate) struct Line {
    strokes: Vec<Stroke>,
}

impl Line {
    fn center_y(&self) -> f32 {
        let (min_y, max_y) = self.strokes.iter().fold(
            (f32::INFINITY, f32::NEG_INFINITY),
            |(lo, hi), s| (lo.min(s.min_y), hi.max(s.max_y)),
        );
        (min_y + max_y) / 2.0
    }

    fn height(&self) -> f32 {
        let (min_y, max_y) = self.strokes.iter().fold(
            (f32::INFINITY, f32::NEG_INFINITY),
            |(lo, hi), s| (lo.min(s.min_y), hi.max(s.max_y)),
        );
        max_y - min_y
    }

    fn bbox(&self) -> [f32; 4] {
        let mut min_x = f32::INFINITY;
        let mut min_y = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut max_y = f32::NEG_INFINITY;
        for s in &self.strokes {
            min_x = min_x.min(s.min_x);
            min_y = min_y.min(s.min_y);
            max_x = max_x.max(s.max_x);
            max_y = max_y.max(s.max_y);
        }
        [min_x, min_y, max_x - min_x, max_y - min_y]
    }

    fn stroke_ids(&self) -> Vec<String> {
        self.strokes.iter().map(|s| s.id.clone()).collect()
    }

    /// Cache key over the line's strokes: their ids and quantized geometry.
    /// Stable when nothing in the line moved; changes the moment a member
    /// stroke is added, removed, or repositioned. Ids are sorted so insertion
    /// order does not perturb the hash.
    fn hash(&self) -> String {
        let mut members: Vec<&Stroke> = self.strokes.iter().collect();
        members.sort_by(|a, b| a.id.cmp(&b.id));
        let mut hasher = Sha256::new();
        for s in members {
            hasher.update(s.id.as_bytes());
            hasher.update(b":");
            for &p in &s.points {
                // Quarter-unit quantization so float noise doesn't bust the cache.
                hasher.update(((p * 4.0).round() as i64).to_le_bytes());
            }
            hasher.update(b";");
        }
        format!("{:x}", hasher.finalize())
    }
}

/// The heavy unit of work, run on the handwriting worker thread: read the note,
/// cluster its strokes into lines, recognize each line (reusing the cache), and
/// write the artifact. Returns `true` when the recognized lines actually
/// changed (worth emitting an event for).
pub(crate) fn process_node(
    node_id: &str,
    path: &str,
    file_type: &str,
    artifact: &Path,
    recognizer: &Recognizer,
) -> Result<bool, String> {
    // Only canvas notes can hold strokes.
    if file_type != "mcanvas" {
        return Ok(false);
    }

    let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    let source_hash = sha256_hex(&bytes);

    let existing: Option<RecognizedPage> = std::fs::read(artifact)
        .ok()
        .and_then(|json| serde_json::from_slice(&json).ok())
        .filter(|page: &RecognizedPage| page.schema_version == SCHEMA_VERSION);

    // Identical bytes: no stroke can have changed.
    if existing
        .as_ref()
        .is_some_and(|page| page.source_hash == source_hash)
    {
        return Ok(false);
    }

    let doc = decode_doc(&bytes)?;
    let strokes = collect_strokes(&doc);

    // A note that lost all its strokes drops its artifact.
    if strokes.is_empty() {
        if artifact.exists() {
            std::fs::remove_file(artifact).map_err(|e| format!("remove handwriting: {e}"))?;
            return Ok(true);
        }
        return Ok(false);
    }

    let lines = cluster_lines(strokes);

    // Per-line cache: reuse recognition for lines whose strokes did not move,
    // so a stroke edit only re-recognizes the lines it actually touched.
    let cached: HashMap<&str, &RecognizedLine> = existing
        .as_ref()
        .map(|page| page.lines.iter().map(|l| (l.hash.as_str(), l)).collect())
        .unwrap_or_default();

    let mut recognized: Vec<RecognizedLine> = Vec::with_capacity(lines.len());
    for line in &lines {
        let hash = line.hash();
        let text = match cached.get(hash.as_str()) {
            Some(prev) => prev.text.clone(),
            None => recognizer.recognize_line(line)?,
        };
        recognized.push(RecognizedLine {
            text,
            bbox: line.bbox(),
            stroke_ids: line.stroke_ids(),
            hash,
        });
    }

    let changed = existing
        .as_ref()
        .is_none_or(|page| page.lines != recognized);

    let page = RecognizedPage {
        node_id: node_id.to_string(),
        source_hash,
        schema_version: SCHEMA_VERSION,
        lines: recognized,
        updated_at: now_ms(),
    };
    write_page(artifact, &page)?;
    Ok(changed)
}

/// Read every stroke element from a note's decoded doc.
fn collect_strokes(doc: &Doc) -> Vec<Stroke> {
    // Acquire the root array before the read txn (get_or_insert opens its own
    // write txn and would deadlock against a held read txn).
    let elements = doc.get_or_insert_array("elements");
    let txn = doc.transact();

    let mut strokes = Vec::new();
    for item in elements.iter(&txn) {
        let Out::YMap(map) = item else {
            continue;
        };
        let element_type = match map.get(&txn, "type") {
            Some(Out::Any(a)) => any_to_i64(&a),
            _ => None,
        };
        if element_type != Some(TYPE_STROKE) {
            continue;
        }
        let Some(id) = map
            .get(&txn, "uuid")
            .and_then(|out| match out {
                Out::Any(a) => any_to_string(&a),
                _ => None,
            })
        else {
            continue;
        };
        let points = match map.get(&txn, "points") {
            Some(Out::Any(a)) => read_floats(&a),
            _ => Vec::new(),
        };
        // Need at least one [x, y, _] sample to bound the stroke.
        if points.len() < 3 {
            continue;
        }

        let mut min_x = f32::INFINITY;
        let mut min_y = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut max_y = f32::NEG_INFINITY;
        for chunk in points.chunks_exact(3) {
            min_x = min_x.min(chunk[0]);
            max_x = max_x.max(chunk[0]);
            min_y = min_y.min(chunk[1]);
            max_y = max_y.max(chunk[1]);
        }

        strokes.push(Stroke {
            id,
            points,
            min_x,
            min_y,
            max_x,
            max_y,
        });
    }
    strokes
}

/// Greedy single-pass clustering of strokes into text lines by vertical band.
/// Simple and deterministic; no column or skew handling (good enough as
/// recognizer input, which segments within a line itself).
fn cluster_lines(mut strokes: Vec<Stroke>) -> Vec<Line> {
    strokes.sort_by(|a, b| {
        a.center_y()
            .partial_cmp(&b.center_y())
            .unwrap_or(Ordering::Equal)
    });

    let mut lines: Vec<Line> = Vec::new();
    for stroke in strokes {
        let attaches = match lines.last() {
            Some(line) => {
                let tol = line.height().max(stroke.height()) * LINE_MERGE_RATIO;
                (stroke.center_y() - line.center_y()).abs() <= tol
            }
            None => false,
        };
        if attaches {
            lines.last_mut().unwrap().strokes.push(stroke);
        } else {
            lines.push(Line {
                strokes: vec![stroke],
            });
        }
    }

    for line in &mut lines {
        line.strokes
            .sort_by(|a, b| a.min_x.partial_cmp(&b.min_x).unwrap_or(Ordering::Equal));
    }
    lines
}

/// Turns one text line's strokes into recognized text.
///
/// STUB: native handwriting recognition is not wired yet. Returns an empty
/// string so the surrounding pipeline — clustering, the per-line cache,
/// artifact I/O, and the `handwriting-updated` event — runs end to end.
/// Replace the body with the model call (the loaded model handle should live on
/// this struct, initialized once like the scribble engine in `transcription.rs`);
/// the signature and everything around it stay as-is.
pub(crate) struct Recognizer;

impl Recognizer {
    pub(crate) fn new() -> Self {
        Self
    }

    pub(crate) fn recognize_line(&self, _line: &Line) -> Result<String, String> {
        Ok(String::new())
    }
}

fn read_floats(any: &Any) -> Vec<f32> {
    match any {
        Any::Array(items) => items
            .iter()
            .filter_map(|a| match a {
                Any::Number(n) => Some(*n as f32),
                Any::BigInt(n) => Some(*n as f32),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn write_page(artifact: &Path, page: &RecognizedPage) -> Result<(), String> {
    if let Some(parent) = artifact.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create handwriting dir: {e}"))?;
    }
    let json = serde_json::to_vec(page).map_err(|e| format!("serialize handwriting: {e}"))?;
    std::fs::write(artifact, json).map_err(|e| format!("write handwriting: {e}"))
}

/// Artifacts are namespaced per repository: `Handwriting/<repo_id>/<node_id>.json`.
pub(crate) fn artifact_path(
    app: &AppHandle,
    repo_id: &str,
    node_id: &str,
) -> Result<PathBuf, String> {
    validate_path_component("repo id", repo_id)?;
    validate_path_component("node id", node_id)?;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("resolve cache dir: {e}"))?;
    Ok(dir
        .join(HANDWRITING_DIR)
        .join(repo_id)
        .join(format!("{node_id}.json")))
}

/// Reject path components that could escape the cache dir. Both ids are
/// frontend-derived and get joined into the artifact path.
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

fn decode_doc(bytes: &[u8]) -> Result<Doc, String> {
    let doc = Doc::new();
    let update = Update::decode_v1(bytes).map_err(|e| format!("decode update: {e}"))?;
    doc.transact_mut()
        .apply_update(update)
        .map_err(|e| format!("apply update: {e}"))?;
    Ok(doc)
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

fn any_to_i64(any: &Any) -> Option<i64> {
    match any {
        Any::BigInt(n) => Some(*n),
        Any::Number(n) => Some(*n as i64),
        _ => None,
    }
}

fn any_to_string(any: &Any) -> Option<String> {
    match any {
        Any::String(s) => Some(s.to_string()),
        _ => None,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::Arc;
    use yrs::{MapPrelim, ReadTxn, StateVector};

    /// Encode a canvas doc whose elements array holds the given strokes, each
    /// `(uuid, points)` where points is a flat `[x, y, p, ...]` buffer.
    fn note_with_strokes(strokes: &[(&str, Vec<f32>)]) -> Vec<u8> {
        let doc = Doc::new();
        let elements = doc.get_or_insert_array("elements");
        let mut txn = doc.transact_mut();
        for (uuid, points) in strokes {
            let map = elements.push_back(&mut txn, MapPrelim::default());
            map.insert(&mut txn, "type", TYPE_STROKE);
            map.insert(&mut txn, "uuid", *uuid);
            let any = Any::Array(Arc::from(
                points.iter().map(|&p| Any::Number(p as f64)).collect::<Vec<_>>(),
            ));
            map.insert(&mut txn, "points", any);
        }
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    fn read_page(artifact: &Path) -> RecognizedPage {
        let bytes = std::fs::read(artifact).unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// A word-sized stroke spanning `x0..x1` with realistic vertical extent,
    /// centered at `cy` (real handwriting strokes are not zero-height).
    fn word(x0: f32, x1: f32, cy: f32) -> Vec<f32> {
        vec![x0, cy - 5.0, 0.0, x1, cy + 5.0, 0.0]
    }

    #[test]
    fn clusters_strokes_into_lines_by_vertical_band() {
        let bytes = note_with_strokes(&[
            ("a", word(0.0, 10.0, 0.0)),
            ("b", word(12.0, 20.0, 1.0)),
            ("c", word(0.0, 10.0, 100.0)),
        ]);
        let strokes = collect_strokes(&decode_doc(&bytes).unwrap());
        let lines = cluster_lines(strokes);

        assert_eq!(lines.len(), 2, "two vertical bands → two lines");
        // First line keeps both strokes, ordered left-to-right.
        assert_eq!(lines[0].stroke_ids(), vec!["a".to_string(), "b".to_string()]);
        assert_eq!(lines[1].stroke_ids(), vec!["c".to_string()]);
    }

    #[test]
    fn unchanged_strokes_keep_a_stable_line_hash() {
        let make = || {
            let bytes = note_with_strokes(&[("a", word(0.0, 10.0, 0.0))]);
            cluster_lines(collect_strokes(&decode_doc(&bytes).unwrap()))
                .remove(0)
                .hash()
        };
        assert_eq!(make(), make());
    }

    #[test]
    fn writes_artifact_and_skips_when_bytes_are_unchanged() {
        let base = std::env::temp_dir().join("handwriting_process_node_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let note_path = base.join("note.mcanvas");
        let artifact = base.join("hw").join("node1.json");

        let bytes = note_with_strokes(&[
            ("a", word(0.0, 10.0, 0.0)),
            ("b", word(0.0, 10.0, 100.0)),
        ]);
        std::fs::write(&note_path, &bytes).unwrap();
        let path = note_path.to_str().unwrap();
        let recognizer = Recognizer::new();

        // First run recognizes and writes one line per band.
        let changed =
            process_node("node1", path, "mcanvas", &artifact, &recognizer).unwrap();
        assert!(changed);
        let page = read_page(&artifact);
        assert_eq!(page.lines.len(), 2);

        // Re-run over identical bytes does no work and reports unchanged.
        let changed_again =
            process_node("node1", path, "mcanvas", &artifact, &recognizer).unwrap();
        assert!(!changed_again);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn dropping_all_strokes_removes_the_artifact() {
        let base = std::env::temp_dir().join("handwriting_empty_strokes_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let note_path = base.join("note.mcanvas");
        let artifact = base.join("hw").join("node1.json");
        let recognizer = Recognizer::new();

        std::fs::write(&note_path, note_with_strokes(&[("a", word(0.0, 10.0, 0.0))]))
            .unwrap();
        let path = note_path.to_str().unwrap();
        assert!(process_node("node1", path, "mcanvas", &artifact, &recognizer).unwrap());
        assert!(artifact.exists());

        // Rewrite with no strokes: the artifact is dropped.
        std::fs::write(&note_path, note_with_strokes(&[])).unwrap();
        let changed =
            process_node("node1", path, "mcanvas", &artifact, &recognizer).unwrap();
        assert!(changed);
        assert!(!artifact.exists());

        std::fs::remove_dir_all(&base).ok();
    }
}
