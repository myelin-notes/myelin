//! Bundled fonts + a cache of krilla `Font` instances.
//!
//! The webview loads Hanken Grotesk (body) as a variable font and Nyght Serif
//! (headings) as static weights; we embed the same TTFs. Hanken varies via the
//! `wght` axis per run so glyph advances match the harvested on-screen positions.
//! Nyght has no variable axis, so we pick the nearest static face (Regular/Bold).
//! `Font` is expensive to create but cheap to clone, so we cache instances keyed by
//! face + rounded weight + optical size.

use std::collections::HashMap;

use krilla::text::{Font, Tag};
use krilla::Data;

use super::contract::FontKey;

const HANKEN: &[u8] = include_bytes!("../../fonts/HankenGrotesk.ttf");
const HANKEN_ITALIC: &[u8] = include_bytes!("../../fonts/HankenGrotesk-Italic.ttf");
const NYGHT: &[u8] = include_bytes!("../../fonts/NyghtSerif-Regular.ttf");
const NYGHT_ITALIC: &[u8] = include_bytes!("../../fonts/NyghtSerif-RegularItalic.ttf");
const NYGHT_BOLD: &[u8] = include_bytes!("../../fonts/NyghtSerif-Bold.ttf");
const NYGHT_BOLD_ITALIC: &[u8] = include_bytes!("../../fonts/NyghtSerif-BoldItalic.ttf");
const MONO: &[u8] = include_bytes!("../../fonts/JetBrainsMono.ttf");

type FaceKey = (u8, bool, bool);
type InstanceKey = (u8, bool, bool, i32, i32);

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
        // Nyght Serif ships static weights only — switch to the bold face past 600.
        let bold = matches!(key, FontKey::Nyght) && weight >= 600.0;
        let ik: InstanceKey = (k, italic, bold, weight.round() as i32, opsz.round() as i32);
        if let Some(font) = self.cache.get(&ik) {
            return Some(font.clone());
        }

        let data = self
            .data
            .entry((k, italic, bold))
            .or_insert_with(|| face_bytes(key, italic, bold).to_vec().into())
            .clone();

        let coords = [(Tag::new(b"wght"), weight), (Tag::new(b"opsz"), opsz)];
        let font = Font::new_variable(data, 0, &coords)?;
        self.cache.insert(ik, font.clone());
        Some(font)
    }
}

fn face_bytes(key: FontKey, italic: bool, bold: bool) -> &'static [u8] {
    match (key, italic, bold) {
        (FontKey::Hanken, false, _) => HANKEN,
        (FontKey::Hanken, true, _) => HANKEN_ITALIC,
        (FontKey::Nyght, false, false) => NYGHT,
        (FontKey::Nyght, true, false) => NYGHT_ITALIC,
        (FontKey::Nyght, false, true) => NYGHT_BOLD,
        (FontKey::Nyght, true, true) => NYGHT_BOLD_ITALIC,
        (FontKey::Mono, _, _) => MONO,
    }
}
