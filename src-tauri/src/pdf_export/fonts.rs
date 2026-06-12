//! Bundled variable fonts + a cache of krilla `Font` instances.
//!
//! The webview loads Inter (body) and Newsreader (headings) as variable fonts from
//! Google Fonts; we embed the same variable TTFs and select `wght`/`opsz` per run so
//! glyph advances match the harvested on-screen positions. `Font` is expensive to
//! create but cheap to clone, so we cache instances keyed by rounded weight + optical
//! size.

use std::collections::HashMap;

use krilla::text::{Font, Tag};
use krilla::Data;

use super::contract::FontKey;

const INTER: &[u8] = include_bytes!("../../fonts/Inter.ttf");
const INTER_ITALIC: &[u8] = include_bytes!("../../fonts/Inter-Italic.ttf");
const NEWSREADER: &[u8] = include_bytes!("../../fonts/Newsreader.ttf");
const NEWSREADER_ITALIC: &[u8] = include_bytes!("../../fonts/Newsreader-Italic.ttf");
const MONO: &[u8] = include_bytes!("../../fonts/JetBrainsMono.ttf");

type FaceKey = (u8, bool);
type InstanceKey = (u8, bool, i32, i32);

pub struct FontRegistry {
    data: HashMap<FaceKey, Data>,
    cache: HashMap<InstanceKey, Font>,
}

impl FontRegistry {
    pub fn new() -> Self {
        Self {
            data: HashMap::new(),
            cache: HashMap::new(),
        }
    }

    pub fn get(&mut self, key: FontKey, italic: bool, weight: f32, opsz: f32) -> Option<Font> {
        let k = key as u8;
        // Mono has no italic face; fall back to upright.
        let italic = italic && !matches!(key, FontKey::Mono);
        let ik: InstanceKey = (k, italic, weight.round() as i32, opsz.round() as i32);
        if let Some(font) = self.cache.get(&ik) {
            return Some(font.clone());
        }

        let data = self
            .data
            .entry((k, italic))
            .or_insert_with(|| face_bytes(key, italic).to_vec().into())
            .clone();

        let coords = [(Tag::new(b"wght"), weight), (Tag::new(b"opsz"), opsz)];
        let font = Font::new_variable(data, 0, &coords)?;
        self.cache.insert(ik, font.clone());
        Some(font)
    }
}

fn face_bytes(key: FontKey, italic: bool) -> &'static [u8] {
    match (key, italic) {
        (FontKey::Inter, false) => INTER,
        (FontKey::Inter, true) => INTER_ITALIC,
        (FontKey::Newsreader, false) => NEWSREADER,
        (FontKey::Newsreader, true) => NEWSREADER_ITALIC,
        (FontKey::Mono, _) => MONO,
    }
}
