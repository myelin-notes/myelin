mod audio_transcript;
mod note_text;
mod yjs;

use std::cell::OnceCell;

use sha2::{Digest, Sha256};
use yrs::Doc;

use audio_transcript::AudioTranscriptProvider;

pub(crate) use note_text::NoteTextProvider;

/// One node's raw bytes plus its Yjs doc, decoded lazily and shared across
/// providers so each reindex decodes the (potentially multi-MB) update once.
pub(crate) struct IndexSource<'a> {
    pub(crate) bytes: &'a [u8],
    doc: OnceCell<Result<Doc, String>>,
}

impl<'a> IndexSource<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            doc: OnceCell::new(),
        }
    }

    pub(crate) fn doc(&self) -> Result<&Doc, String> {
        self.doc
            .get_or_init(|| yjs::decode_doc(self.bytes))
            .as_ref()
            .map_err(Clone::clone)
    }
}

pub(crate) trait IndexProvider: Send + Sync {
    fn kind(&self) -> &'static str;
    fn applies_to(&self, file_type: &str) -> bool;
    fn build(&self, source: &IndexSource) -> Result<String, String>;
}

pub(crate) fn default_providers() -> Vec<Box<dyn IndexProvider>> {
    vec![
        Box::new(NoteTextProvider),
        Box::new(AudioTranscriptProvider),
    ]
}

pub(crate) fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}
