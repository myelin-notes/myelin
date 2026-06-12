mod audio_transcript;
mod note_text;
mod yjs;

use sha2::{Digest, Sha256};

use audio_transcript::AudioTranscriptProvider;

pub(crate) use note_text::NoteTextProvider;

pub(crate) trait IndexProvider: Send + Sync {
    fn kind(&self) -> &'static str;
    fn applies_to(&self, file_type: &str) -> bool;
    /// Digest of the provider's *input* slice, cheaper than building. `build`
    /// is skipped while it matches, so an edit elsewhere in the same file
    /// doesn't re-run expensive derivations (OCR later should hash its source
    /// media bytes here). Return Ok(None) when no digest cheaper than
    /// building exists — the store then builds once and fingerprints the
    /// output instead.
    fn fingerprint(&self, bytes: &[u8]) -> Result<Option<String>, String> {
        let _ = bytes;
        Ok(None)
    }
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
