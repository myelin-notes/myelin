use tauri::{ipc::Response, AppHandle};
use tauri_plugin_clipboard_manager::ClipboardExt;

fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        writer
            .write_image_data(rgba)
            .map_err(|error| error.to_string())?;
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn read_clipboard_image_png(app: AppHandle) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let image = app
            .clipboard()
            .read_image()
            .map_err(|error| error.to_string())?;
        encode_png(image.rgba(), image.width(), image.height())
    })
    .await
    .map_err(|error| error.to_string())??;

    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::encode_png;

    #[test]
    fn encodes_rgba_as_png() {
        let bytes = encode_png(&[255, 0, 0, 255], 1, 1).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }
}
