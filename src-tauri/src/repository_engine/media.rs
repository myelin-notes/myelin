use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use yrs::{
    block::{HAS_ORIGIN, HAS_PARENT_SUB, HAS_RIGHT_ORIGIN},
    encoding::{
        read::{Cursor, Error, Read},
        write::Write,
    },
    updates::decoder::Decode,
    Any, Update,
};

const FILE_TYPE: &str = "media";
// Below this, a separate file costs more than the copies it saves.
const MIN_BYTES: usize = if cfg!(test) { 1024 } else { 64 * 1024 };
const REFERENCE_PREFIX: &[u8] = b"\0myelin-media:";
const HASH_LENGTH: usize = 64;

pub(super) struct Extracted<'a> {
    pub document: Cow<'a, [u8]>,
    /// By hash, repeated when the document holds the same bytes twice.
    pub media: Vec<(String, &'a [u8])>,
}

/// Swaps large binary values for references to their hash. An update that cannot be parsed or fails
/// verification comes back unchanged: keeping media inline only costs space.
pub(super) fn extract(update: &[u8]) -> Extracted<'_> {
    let mut media = Vec::new();
    let document = rewrite(update, |bytes| {
        if bytes.len() < MIN_BYTES {
            return None;
        }
        let hash = hash(bytes);
        let reference = [REFERENCE_PREFIX, hash.as_bytes()].concat();
        media.push((hash, bytes));
        Some(reference)
    });
    match document {
        Ok(Cow::Owned(document)) if same_state(update, &document) => Extracted {
            document: Cow::Owned(document),
            media,
        },
        _ => Extracted {
            document: Cow::Borrowed(update),
            media: Vec::new(),
        },
    }
}

/// Restores referenced media. `read` returning `None`, or bytes that do not match their hash, leaves
/// that reference in place: the rest of the document stays usable and the reference survives saves.
pub(super) fn inline(
    update: &[u8],
    mut read: impl FnMut(&str) -> Option<Vec<u8>>,
) -> Cow<'_, [u8]> {
    rewrite(update, |bytes| {
        let hash = reference_hash(bytes)?;
        read(hash).filter(|media| self::hash(media) == hash)
    })
    .unwrap_or(Cow::Borrowed(update))
}

/// Whether `extract` would change this update, without hashing anything.
pub(super) fn has_inline_media(update: &[u8]) -> bool {
    update.len() >= MIN_BYTES
        && rewrite(update, |bytes| (bytes.len() >= MIN_BYTES).then(Vec::new))
            .is_ok_and(|document| matches!(document, Cow::Owned(_)))
}

/// A hidden node for a media file. Its fixed timestamps keep the sidecar identical on every device,
/// so two devices adding the same bytes never conflict.
pub(super) fn node(hash: &str, byte_length: usize) -> Value {
    json!({
        "id": hash, "type": "file", "name": hash, "fileType": FILE_TYPE, "parentId": null,
        "tags": [], "createdAt": 0, "modifiedAt": 0,
        "system": { "kind": "media", "byteLength": byte_length }
    })
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn reference_hash(bytes: &[u8]) -> Option<&str> {
    let hash = bytes.strip_prefix(REFERENCE_PREFIX)?;
    (hash.len() == HASH_LENGTH
        && hash
            .iter()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')))
    .then(|| std::str::from_utf8(hash).ok())
    .flatten()
}

fn same_state(left: &[u8], right: &[u8]) -> bool {
    let (Ok(left), Ok(right)) = (Update::decode_v1(left), Update::decode_v1(right)) else {
        return false;
    };
    left.state_vector() == right.state_vector() && left.delete_set() == right.delete_set()
}

fn skip_id(cursor: &mut Cursor) -> Result<(), Error> {
    cursor.read_var::<u64>()?;
    cursor.read_var::<u32>()?;
    Ok(())
}

// yrs keeps its decoded blocks private, so this walks the Yjs v1 update format directly. Struct IDs
// and lengths never change, which is what lets a copy holding references merge with one holding bytes.
fn rewrite<'a>(
    update: &'a [u8],
    mut replace: impl FnMut(&'a [u8]) -> Option<Vec<u8>>,
) -> Result<Cow<'a, [u8]>, Error> {
    let mut cursor = Cursor::new(update);
    let mut output = Vec::new();
    let mut copied = 0;
    let clients: u32 = cursor.read_var()?;
    for _ in 0..clients {
        let structs: u32 = cursor.read_var()?;
        skip_id(&mut cursor)?;
        for _ in 0..structs {
            let info = cursor.read_u8()?;
            // GC and skip structs carry only a length.
            if info == 0 || info == 10 {
                cursor.read_var::<u32>()?;
                continue;
            }
            if info & HAS_ORIGIN != 0 {
                skip_id(&mut cursor)?;
            }
            if info & HAS_RIGHT_ORIGIN != 0 {
                skip_id(&mut cursor)?;
            }
            if info & (HAS_ORIGIN | HAS_RIGHT_ORIGIN) == 0 {
                if cursor.read_var::<u32>()? == 1 {
                    cursor.read_buf()?;
                } else {
                    skip_id(&mut cursor)?;
                }
                if info & HAS_PARENT_SUB != 0 {
                    cursor.read_buf()?;
                }
            }
            match info & 0b1111 {
                // Deleted
                1 => {
                    cursor.read_var::<u32>()?;
                }
                // Binary
                3 => {
                    let start = cursor.next;
                    let length = cursor.read_buf()?.len();
                    let bytes = &update[cursor.next - length..cursor.next];
                    if let Some(replacement) = replace(bytes) {
                        output.extend_from_slice(&update[copied..start]);
                        output.write_buf(replacement);
                        copied = cursor.next;
                    }
                }
                // String, embed
                4 | 5 => {
                    cursor.read_buf()?;
                }
                // Format
                6 => {
                    cursor.read_buf()?;
                    cursor.read_buf()?;
                }
                // Type
                7 => match cursor.read_u8()? {
                    0 | 1 | 2 | 4 | 6 | 15 => {}
                    3 => {
                        cursor.read_buf()?;
                    }
                    _ => return Err(Error::UnexpectedValue),
                },
                // Any: the form yrs writes for byte values
                8 => {
                    let values: u32 = cursor.read_var()?;
                    for _ in 0..values {
                        let start = cursor.next;
                        let Any::Buffer(bytes) = Any::decode(&mut cursor)? else {
                            continue;
                        };
                        let bytes = &update[cursor.next - bytes.len()..cursor.next];
                        if let Some(replacement) = replace(bytes) {
                            output.extend_from_slice(&update[copied..start]);
                            Any::Buffer(replacement.into()).encode(&mut output);
                            copied = cursor.next;
                        }
                    }
                }
                // JSON, sub-documents and moves are never written by Myelin.
                _ => return Err(Error::UnexpectedValue),
            }
        }
    }
    if copied == 0 {
        return Ok(Cow::Borrowed(update));
    }
    output.extend_from_slice(&update[copied..]);
    Ok(Cow::Owned(output))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository_engine::document;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::collections::HashMap;
    use yrs::{Array, Doc, Map, MapPrelim, Out, Transact};

    fn fixture(key: &str) -> Vec<u8> {
        let fixture: Value = serde_json::from_str(include_str!("fixtures/yjs-media.json")).unwrap();
        STANDARD.decode(fixture[key].as_str().unwrap()).unwrap()
    }

    fn stored(extracted: &Extracted) -> HashMap<String, Vec<u8>> {
        extracted
            .media
            .iter()
            .map(|(hash, bytes)| (hash.clone(), bytes.to_vec()))
            .collect()
    }

    fn element_bytes(doc: &Doc, index: u32, key: &str) -> Vec<u8> {
        let elements = doc.get_or_insert_array("elements");
        let txn = doc.transact();
        let Some(Out::YMap(element)) = elements.get(&txn, index) else {
            panic!("missing element");
        };
        let Some(Out::Any(Any::Buffer(bytes))) = element.get(&txn, key) else {
            panic!("missing bytes");
        };
        bytes.to_vec()
    }

    #[test]
    fn real_yjs_documents_round_trip_byte_for_byte_and_store_shared_media_once() {
        let original = fixture("document");
        let extracted = extract(&original);
        let media = stored(&extracted);
        assert_eq!(media.len(), 1);
        assert_eq!(extracted.media.len(), 2);
        assert!(extracted.document.len() < original.len() - 2048);
        assert!(!has_inline_media(&extracted.document));
        assert!(has_inline_media(&original));

        let restored = inline(&extracted.document, |hash| media.get(hash).cloned());
        assert_eq!(restored.as_ref(), original.as_slice());

        let doc = document::decode(&extracted.document).unwrap();
        let reference = element_bytes(&doc, 0, "imageData");
        assert!(reference.starts_with(REFERENCE_PREFIX));
        assert_eq!(element_bytes(&doc, 1, "pdfData"), reference);
    }

    #[test]
    fn a_copy_holding_references_converges_with_one_holding_bytes() {
        let original = fixture("document");
        let edit = fixture("edit");
        let extracted = extract(&original);
        let mut media = stored(&extracted);

        // A second device edits the bytes-holding copy; the merge must work in either order.
        let edited = document::merge(&original, &edit).unwrap();
        let expected = extract(&edited);
        media.extend(stored(&expected));
        assert_eq!(media.len(), 2);
        for merged in [
            document::merge(&extracted.document, &edited).unwrap(),
            document::merge(&edited, &extracted.document).unwrap(),
        ] {
            assert_eq!(
                document::vector(&document::decode(&merged).unwrap()),
                document::vector(&document::decode(&edited).unwrap())
            );
            let restored = inline(&merged, |hash| media.get(hash).cloned());
            let doc = document::decode(&restored).unwrap();
            assert_eq!(
                element_bytes(&doc, 0, "imageData"),
                element_bytes(&document::decode(&edited).unwrap(), 0, "imageData")
            );
            assert_eq!(
                element_bytes(&doc, 1, "pdfData"),
                element_bytes(&document::decode(&edited).unwrap(), 1, "pdfData")
            );
        }
    }

    #[test]
    fn extracting_again_changes_nothing() {
        let original = fixture("document");
        let extracted = extract(&original);
        let again = extract(&extracted.document);
        assert!(again.media.is_empty());
        assert_eq!(again.document, extracted.document);
    }

    #[test]
    fn missing_or_tampered_media_keeps_the_reference_and_the_rest_of_the_document() {
        let original = fixture("document");
        let extracted = extract(&original);
        let missing = inline(&extracted.document, |_| None);
        assert_eq!(missing, extracted.document);
        let tampered = inline(&extracted.document, |_| Some(vec![0; 2048]));
        assert_eq!(tampered, extracted.document);
        document::decode(&tampered).unwrap();
    }

    #[test]
    fn references_with_an_invalid_hash_are_not_read() {
        for bytes in [
            [REFERENCE_PREFIX, b"../../secret"].concat(),
            [REFERENCE_PREFIX, "A".repeat(HASH_LENGTH).as_bytes()].concat(),
            [REFERENCE_PREFIX, "a".repeat(HASH_LENGTH + 1).as_bytes()].concat(),
        ] {
            assert_eq!(reference_hash(&bytes), None);
        }
        assert!(
            reference_hash(&[REFERENCE_PREFIX, "a".repeat(HASH_LENGTH).as_bytes()].concat())
                .is_some()
        );
    }

    #[test]
    fn bytes_written_by_yrs_as_any_values_are_extracted_too() {
        let doc = Doc::new();
        let elements = doc.get_or_insert_array("elements");
        {
            let mut txn = doc.transact_mut();
            let element = elements.push_back(&mut txn, MapPrelim::default());
            element.insert(&mut txn, "imageData", Any::Buffer(vec![7; 4096].into()));
            element.insert(&mut txn, "small", Any::Buffer(vec![7; 16].into()));
        }
        let original = document::bytes(&doc);
        let extracted = extract(&original);
        assert_eq!(extracted.media.len(), 1);
        assert_eq!(extracted.media[0].1, vec![7; 4096].as_slice());
        let media = stored(&extracted);
        let restored = inline(&extracted.document, |hash| media.get(hash).cloned());
        assert_eq!(restored.as_ref(), original.as_slice());
    }

    #[test]
    fn unparseable_updates_are_returned_untouched() {
        let original = fixture("document");
        for broken in [&original[..original.len() / 2], &[0xff; 2048][..], &[][..]] {
            let extracted = extract(broken);
            assert_eq!(extracted.document.as_ref(), broken);
            assert!(extracted.media.is_empty());
            assert_eq!(inline(broken, |_| None).as_ref(), broken);
        }
    }
}
