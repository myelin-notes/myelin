//! On-device handwriting recognition as a Tauri plugin.
//!
//! Callers send ink as strokes on every platform; each backend decides whether it reads them as
//! strokes or as a rendered image. Apple platforms render the strokes and run Vision. Other
//! platforms reject `recognize` until they get a backend.

use serde::Deserialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_vendor = "apple")]
mod apple;
#[cfg(any(target_vendor = "apple", test))]
mod raster;

#[derive(Deserialize)]
pub struct Stroke {
    /// Flat `[x, y, x, y, ...]` in world units.
    pub points: Vec<f32>,
    /// Rendered ink width in world units.
    pub width: f32,
}

/// One string per block, in input order. Lines within a block are joined with `\n`.
#[tauri::command]
async fn recognize(blocks: Vec<Vec<Stroke>>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        blocks
            .iter()
            .map(|strokes| recognize_block(strokes))
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(target_vendor = "apple")]
fn recognize_block(strokes: &[Stroke]) -> Result<String, String> {
    match raster::render_png(strokes)? {
        Some(png) => apple::recognize_png(&png),
        None => Ok(String::new()),
    }
}

#[cfg(not(target_vendor = "apple"))]
fn recognize_block(_strokes: &[Stroke]) -> Result<String, String> {
    Err("handwriting recognition is not available on this platform".into())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("handwriting")
        .invoke_handler(tauri::generate_handler![recognize])
        .build()
}
