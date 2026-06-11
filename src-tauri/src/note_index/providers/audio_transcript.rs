use yrs::{Array, Map, Out, Transact};

use super::yjs::{any_to_i64, any_to_string, decode_doc, normalize, TYPE_AUDIO};
use super::{sha256_hex, IndexProvider};

/// Whisper transcripts are generated at capture time and persisted on the
/// AUDIO element; this provider only pulls them out of the note bytes.
pub(crate) struct AudioTranscriptProvider;

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
        extract_audio_transcripts(bytes)
    }
}

/// Extract whisper transcripts from a note's AUDIO elements.
fn extract_audio_transcripts(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Ok(String::new());
    }

    let doc = decode_doc(bytes)?;
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

        if let Some(Out::Any(a)) = map.get(&txn, "transcript") {
            if let Some(transcript) = any_to_string(&a) {
                let trimmed = transcript.trim();
                if !trimmed.is_empty() {
                    parts.push(trimmed.to_string());
                }
            }
        }
    }

    Ok(normalize(&parts.join("\n\n")))
}

#[cfg(test)]
mod tests {
    use super::*;

    use yrs::{Array, Doc, Map, MapPrelim, ReadTxn, StateVector, Transact};

    const FIXTURE: &[u8] = include_bytes!("../test_fixture.bin");

    /// Encode a doc whose elements array holds one AUDIO element map.
    fn audio_note_bytes(transcript: &str) -> Vec<u8> {
        let doc = Doc::new();
        let elements = doc.get_or_insert_array("elements");
        let mut txn = doc.transact_mut();
        let map = elements.push_back(&mut txn, MapPrelim::default());
        map.insert(&mut txn, "type", TYPE_AUDIO);
        map.insert(&mut txn, "transcript", transcript);
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    #[test]
    fn audio_transcripts_extracted_from_audio_elements() {
        let bytes = audio_note_bytes("  hello transcribed   world  ");
        assert_eq!(
            extract_audio_transcripts(&bytes).unwrap(),
            "hello transcribed world"
        );
    }

    #[test]
    fn empty_bytes_yield_empty_string() {
        assert_eq!(extract_audio_transcripts(&[]).unwrap(), "");
    }

    #[test]
    fn fixture_without_audio_yields_empty_string() {
        assert_eq!(extract_audio_transcripts(FIXTURE).unwrap(), "");
    }
}
