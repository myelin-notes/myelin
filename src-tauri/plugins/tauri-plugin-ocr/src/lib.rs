//! Platform OCR for Myelin, exposed as a Tauri plugin.
//!
//! On macOS this runs Apple's Vision text recognizer (see `apple.rs`). On every
//! other platform there is no OCR backend, so [`recognize`] returns no lines.
//! The recognizer operates on a plain 8-bit grayscale bitmap so callers (e.g.
//! the handwriting engine, which rasterizes strokes) stay platform-agnostic.

use serde::Serialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "macos")]
mod apple;

/// One recognized line of text with the engine's confidence in `[0, 1]`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLine {
    pub text: String,
    pub confidence: f32,
}

/// An 8-bit grayscale image: `pixels` is row-major, one byte per pixel, so
/// `pixels.len()` must equal `width * height`.
pub struct GrayImage<'a> {
    pub width: usize,
    pub height: usize,
    pub pixels: &'a [u8],
}

/// Recognize text in a grayscale image, returning the lines top to bottom.
///
/// On non-Apple platforms there is no backend, so this is always `Ok(vec![])`.
pub fn recognize(image: &GrayImage) -> Result<Vec<OcrLine>, String> {
    if image.width == 0 || image.height == 0 {
        return Ok(Vec::new());
    }
    if image.pixels.len() != image.width * image.height {
        return Err(format!(
            "pixel buffer is {} bytes, expected {} for {}x{}",
            image.pixels.len(),
            image.width * image.height,
            image.width,
            image.height,
        ));
    }

    #[cfg(target_os = "macos")]
    {
        apple::recognize(image)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

/// Register the plugin with the Tauri app.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ocr").build()
}
