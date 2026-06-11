mod audio_transcript;
mod note_text;
mod yjs;

use sha2::{Digest, Sha256};

use audio_transcript::AudioTranscriptProvider;

pub(crate) use note_text::NoteTextProvider;

pub(crate) trait IndexProvider: Send + Sync {
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
