//! Plain-text extraction from a note's persisted Yjs bytes, using `yrs`.
//!
//! Mirrors the JS reference in `src/pages/canvas/page-frame/preview-text.ts`:
//! page-frame rich text lives in `pf-<uuid>` XML fragments (walked here and
//! joined with `\n` at block boundaries, like ProseMirror's `textBetween`),
//! while standalone TEXT elements store their string directly on the element map.

use yrs::{Array, GetString, Map, Out, ReadTxn, Transact, XmlFragment, XmlOut};

use super::yjs::{any_to_i64, any_to_string, decode_doc, normalize, TYPE_PAGE_FRAME, TYPE_TEXT};
use super::IndexProvider;

pub(crate) struct NoteTextProvider;

impl IndexProvider for NoteTextProvider {
    fn kind(&self) -> &'static str {
        "note-text"
    }
    fn applies_to(&self, file_type: &str) -> bool {
        file_type == "mcanvas"
    }
    fn build(&self, bytes: &[u8]) -> Result<String, String> {
        extract_note_text(bytes)
    }
}

/// Recursively collect text from an xml node, inserting `\n` at block
/// boundaries to mirror y-prosemirror's `textBetween(.., '\n', ' ')`.
fn walk_xml<T: ReadTxn>(txn: &T, node: &XmlOut, out: &mut String) {
    match node {
        XmlOut::Element(el) => {
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            for child in el.children(txn) {
                walk_xml(txn, &child, out);
            }
        }
        XmlOut::Text(text) => {
            out.push_str(&text.get_string(txn));
        }
        XmlOut::Fragment(frag) => {
            for child in frag.children(txn) {
                walk_xml(txn, &child, out);
            }
        }
    }
}

/// Extract searchable plain text from a note's full Yjs update bytes.
fn extract_note_text(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Ok(String::new());
    }

    let doc = decode_doc(bytes)?;

    // Acquire the root array BEFORE opening the read txn — get_or_insert_* opens
    // its own write txn and would deadlock against a held read txn.
    let elements = doc.get_or_insert_array("elements");

    let txn = doc.transact();
    let mut parts: Vec<String> = Vec::new();

    for item in elements.iter(&txn) {
        let map = match item {
            Out::YMap(m) => m,
            _ => continue,
        };

        let element_type = match map.get(&txn, "type") {
            Some(Out::Any(a)) => any_to_i64(&a),
            _ => None,
        };

        match element_type {
            Some(TYPE_TEXT) => {
                if let Some(Out::Any(a)) = map.get(&txn, "text") {
                    if let Some(text) = any_to_string(&a) {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            parts.push(trimmed.to_string());
                        }
                    }
                }
            }
            Some(TYPE_PAGE_FRAME) => {
                let uuid = match map.get(&txn, "uuid") {
                    Some(Out::Any(a)) => any_to_string(&a),
                    _ => None,
                };
                if let Some(uuid) = uuid {
                    // Read-only fragment lookup (no insert, no write txn) so we
                    // don't deadlock against the held read txn.
                    if let Some(frag) = txn.get_xml_fragment(format!("pf-{uuid}").as_str()) {
                        let mut buf = String::new();
                        for child in frag.children(&txn) {
                            walk_xml(&txn, &child, &mut buf);
                        }
                        let trimmed = buf.trim();
                        if !trimmed.is_empty() {
                            parts.push(trimmed.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    Ok(normalize(&parts.join("\n\n")))
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::super::yjs::TYPE_AUDIO;
    use yrs::{Array, Doc, Map, MapPrelim, ReadTxn, StateVector, Transact};

    // A real note's persisted bytes, produced by the app's own YDocManager +
    // y-prosemirror + schema (Y.encodeStateAsUpdate). Contents: one page frame
    // with a heading + two paragraphs, plus one standalone TEXT element. To
    // regenerate after a schema change, build the same doc in a node script and
    // write `Y.encodeStateAsUpdate(doc)` here.
    const FIXTURE: &[u8] = include_bytes!("../test_fixture.bin");

    #[test]
    fn extracts_page_frame_and_text_element() {
        let text = extract_note_text(FIXTURE).expect("extraction succeeds");
        assert!(text.contains("Indexed Heading Title"), "got: {text:?}");
        assert!(text.contains("The quick brown fox jumps over the lazy dog."));
        assert!(text.contains("searchable keyword zebra"));
        // Standalone TEXT element string is included, not just page frames.
        assert!(text.contains("standalone canvas note text widget"));
    }

    #[test]
    fn empty_bytes_yield_empty_string() {
        assert_eq!(extract_note_text(&[]).unwrap(), "");
    }

    #[test]
    fn audio_transcripts_are_not_note_text() {
        let doc = Doc::new();
        let elements = doc.get_or_insert_array("elements");
        let mut txn = doc.transact_mut();
        let map = elements.push_back(&mut txn, MapPrelim::default());
        map.insert(&mut txn, "type", TYPE_AUDIO);
        map.insert(&mut txn, "transcript", "  hello transcribed   world  ");
        let bytes = txn.encode_state_as_update_v1(&StateVector::default());

        assert_eq!(extract_note_text(&bytes).unwrap(), "");
    }
}
