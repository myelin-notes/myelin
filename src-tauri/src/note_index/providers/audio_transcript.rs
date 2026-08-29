use yrs::{Any, Array, Doc, Map, Out, Transact};

use super::yjs::{any_to_i64, any_to_string, normalize, TYPE_AUDIO};
use super::{IndexProvider, IndexSource};

/// Whisper transcripts are generated at capture time and persisted on the
/// AUDIO element as timed segments; this provider only pulls them out of the
/// note bytes and drops the timings.
pub(crate) struct AudioTranscriptProvider;

impl IndexProvider for AudioTranscriptProvider {
    fn kind(&self) -> &'static str {
        "audio-transcript"
    }
    fn applies_to(&self, file_type: &str) -> bool {
        file_type == "mcanvas"
    }
    fn build(&self, source: &IndexSource) -> Result<String, String> {
        if source.bytes.is_empty() {
            return Ok(String::new());
        }
        extract_audio_transcripts(source.doc()?)
    }
}

/// Extract whisper transcripts from a note's AUDIO elements.
fn extract_audio_transcripts(doc: &Doc) -> Result<String, String> {
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
        if element_type != Some(TYPE_AUDIO) {
            continue;
        }

        if let Some(Out::Any(a)) = map.get(&txn, "transcriptSegments") {
            let transcript = segment_texts(&a).join(" ");
            if !transcript.is_empty() {
                parts.push(transcript);
            }
        }
    }

    Ok(normalize(&parts.join("\n\n")))
}

/// The `text` of each entry in a `transcriptSegments` array, skipping malformed ones.
fn segment_texts(segments: &Any) -> Vec<String> {
    let Any::Array(entries) = segments else {
        return Vec::new();
    };

    entries
        .iter()
        .filter_map(|entry| match entry {
            Any::Map(fields) => fields.get("text").and_then(any_to_string),
            _ => None,
        })
        .filter(|text| !text.trim().is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::HashMap;
    use std::sync::Arc;
    use yrs::{Array, Doc, Map, MapPrelim, ReadTxn, StateVector, Transact};

    const FIXTURE: &[u8] = include_bytes!("../test_fixture.bin");

    fn segment(start: f64, end: f64, text: &str) -> Any {
        Any::Map(Arc::new(HashMap::from([
            ("startSeconds".to_string(), Any::Number(start)),
            ("endSeconds".to_string(), Any::Number(end)),
            ("text".to_string(), Any::String(text.into())),
        ])))
    }

    /// Encode a doc whose elements array holds one AUDIO element map.
    fn audio_note_bytes(segments: Vec<Any>) -> Vec<u8> {
        let doc = Doc::new();
        let elements = doc.get_or_insert_array("elements");
        let mut txn = doc.transact_mut();
        let map = elements.push_back(&mut txn, MapPrelim::default());
        map.insert(&mut txn, "type", TYPE_AUDIO);
        map.insert(
            &mut txn,
            "transcriptSegments",
            Any::Array(Arc::from(segments)),
        );
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    #[test]
    fn audio_transcripts_extracted_from_audio_elements() {
        let bytes = audio_note_bytes(vec![
            segment(0.0, 1.5, "  hello transcribed  "),
            segment(1.5, 3.0, "world  "),
        ]);
        let source = IndexSource::new(&bytes);
        assert_eq!(
            AudioTranscriptProvider.build(&source).unwrap(),
            "hello transcribed world"
        );
    }

    #[test]
    fn malformed_segments_are_skipped() {
        let bytes = audio_note_bytes(vec![
            Any::String("not a segment".into()),
            segment(0.0, 1.0, "kept"),
            Any::Map(Arc::new(HashMap::from([(
                "startSeconds".to_string(),
                Any::Number(2.0),
            )]))),
        ]);
        let source = IndexSource::new(&bytes);
        assert_eq!(AudioTranscriptProvider.build(&source).unwrap(), "kept");
    }

    #[test]
    fn empty_bytes_yield_empty_string() {
        let source = IndexSource::new(&[]);
        assert_eq!(AudioTranscriptProvider.build(&source).unwrap(), "");
    }

    #[test]
    fn fixture_without_audio_yields_empty_string() {
        let source = IndexSource::new(FIXTURE);
        assert_eq!(AudioTranscriptProvider.build(&source).unwrap(), "");
    }
}
