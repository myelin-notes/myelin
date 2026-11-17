//! On-device handwriting recognition as a Tauri plugin.
//!
//! Callers send ink as strokes on every platform; each backend decides whether it reads them as
//! strokes or as a rendered image. Apple platforms render the strokes and run Vision; Windows
//! feeds them to Windows Ink; Android splits them into lines for ML Kit. Other platforms reject
//! `recognize`.

use serde::Deserialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
mod android;
#[cfg(target_vendor = "apple")]
mod apple;
#[cfg(any(target_os = "android", test))]
mod lines;
#[cfg(target_vendor = "apple")]
mod raster;
#[cfg(all(test, any(target_vendor = "apple", windows)))]
mod test_ink;
#[cfg(windows)]
mod windows_ink;

#[derive(Deserialize)]
pub struct Stroke {
    /// Flat `[x, y, x, y, ...]` in world units.
    pub points: Vec<f32>,
    /// Rendered ink width in world units.
    pub width: f32,
}

/// One string per block, in input order; lines or words within a block are whitespace-separated.
#[tauri::command]
async fn recognize<R: Runtime>(
    app: AppHandle<R>,
    blocks: Vec<Vec<Stroke>>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || recognize_blocks(&app, &blocks))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(target_vendor = "apple")]
fn recognize_blocks<R: Runtime>(
    _app: &AppHandle<R>,
    blocks: &[Vec<Stroke>],
) -> Result<Vec<String>, String> {
    blocks
        .iter()
        .map(|strokes| match raster::render_png(strokes)? {
            Some(png) => apple::recognize_png(&png),
            None => Ok(String::new()),
        })
        .collect()
}

#[cfg(windows)]
fn recognize_blocks<R: Runtime>(
    _app: &AppHandle<R>,
    blocks: &[Vec<Stroke>],
) -> Result<Vec<String>, String> {
    blocks
        .iter()
        .map(|strokes| windows_ink::recognize(strokes))
        .collect()
}

#[cfg(target_os = "android")]
fn recognize_blocks<R: Runtime>(
    app: &AppHandle<R>,
    blocks: &[Vec<Stroke>],
) -> Result<Vec<String>, String> {
    android::recognize(app, blocks)
}

#[cfg(not(any(target_vendor = "apple", windows, target_os = "android")))]
fn recognize_blocks<R: Runtime>(
    _app: &AppHandle<R>,
    _blocks: &[Vec<Stroke>],
) -> Result<Vec<String>, String> {
    Err("handwriting recognition is not available on this platform".into())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("handwriting")
        .invoke_handler(tauri::generate_handler![recognize])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin(
                    "com.github.wintersteve25.myelin.handwriting",
                    "HandwritingPlugin",
                )?;
                _app.manage(android::MlKit(handle));
            }
            Ok(())
        })
        .build()
}
