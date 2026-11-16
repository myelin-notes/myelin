use tauri::{ipc::Response, Webview};

#[cfg(desktop)]
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

// tauri-plugin-clipboard-manager's read_image is "Unsupported on this platform" on mobile,
// so iOS and Android read the system clipboard directly.
#[cfg(desktop)]
fn read_image_png(webview: &Webview) -> Result<Vec<u8>, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let image = webview
        .clipboard()
        .read_image()
        .map_err(|error| error.to_string())?;
    encode_png(image.rgba(), image.width(), image.height())
}

#[cfg(target_os = "ios")]
fn read_image_png(_webview: &Webview) -> Result<Vec<u8>, String> {
    use objc2_ui_kit::UIPasteboard;

    let pasteboard = UIPasteboard::generalPasteboard();
    // hasImages doesn't trigger the "Allow Paste" prompt; reading contents does.
    if !unsafe { pasteboard.hasImages() } {
        return Err("Clipboard has no image".into());
    }
    let image = unsafe { pasteboard.image() }.ok_or("Clipboard has no image")?;
    let png = image
        .png_representation()
        .ok_or("Could not encode clipboard image")?;
    Ok(png.to_vec())
}

#[cfg(target_os = "android")]
fn read_image_png(webview: &Webview) -> Result<Vec<u8>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .with_webview(move |platform| {
            platform.jni_handle().exec(move |env, activity, _| {
                let result = read_android_image_png(env, activity);
                if result.is_err() {
                    // A pending Java exception would be rethrown on the UI thread and crash the app.
                    let _ = env.exception_clear();
                }
                let _ = tx.send(result.map_err(|error| error.to_string()));
            });
        })
        .map_err(|error| error.to_string())?;
    rx.recv()
        .map_err(|error| error.to_string())??
        .ok_or_else(|| "Clipboard has no image".into())
}

#[cfg(target_os = "android")]
fn read_android_image_png(
    env: &mut jni::JNIEnv,
    activity: &jni::objects::JObject,
) -> jni::errors::Result<Option<Vec<u8>>> {
    let service = env.new_string("clipboard")?;
    let manager = env
        .call_method(
            activity,
            "getSystemService",
            "(Ljava/lang/String;)Ljava/lang/Object;",
            &[(&service).into()],
        )?
        .l()?;
    // The description doesn't trigger Android 12+'s "pasted from clipboard" toast; getPrimaryClip does.
    let description = env
        .call_method(
            &manager,
            "getPrimaryClipDescription",
            "()Landroid/content/ClipDescription;",
            &[],
        )?
        .l()?;
    if description.is_null() {
        return Ok(None);
    }
    let image_mime = env.new_string("image/*")?;
    let has_image = env
        .call_method(
            &description,
            "hasMimeType",
            "(Ljava/lang/String;)Z",
            &[(&image_mime).into()],
        )?
        .z()?;
    if !has_image {
        return Ok(None);
    }

    let clip = env
        .call_method(
            &manager,
            "getPrimaryClip",
            "()Landroid/content/ClipData;",
            &[],
        )?
        .l()?;
    if clip.is_null() {
        return Ok(None);
    }
    let item = env
        .call_method(
            &clip,
            "getItemAt",
            "(I)Landroid/content/ClipData$Item;",
            &[0.into()],
        )?
        .l()?;
    let uri = env
        .call_method(&item, "getUri", "()Landroid/net/Uri;", &[])?
        .l()?;
    if uri.is_null() {
        return Ok(None);
    }
    let resolver = env
        .call_method(
            activity,
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )?
        .l()?;
    let stream = env
        .call_method(
            &resolver,
            "openInputStream",
            "(Landroid/net/Uri;)Ljava/io/InputStream;",
            &[(&uri).into()],
        )?
        .l()?;
    let bitmap = env
        .call_static_method(
            "android/graphics/BitmapFactory",
            "decodeStream",
            "(Ljava/io/InputStream;)Landroid/graphics/Bitmap;",
            &[(&stream).into()],
        )?
        .l()?;
    env.call_method(&stream, "close", "()V", &[])?;
    if bitmap.is_null() {
        return Ok(None);
    }

    let png = env
        .get_static_field(
            "android/graphics/Bitmap$CompressFormat",
            "PNG",
            "Landroid/graphics/Bitmap$CompressFormat;",
        )?
        .l()?;
    let output = env.new_object("java/io/ByteArrayOutputStream", "()V", &[])?;
    env.call_method(
        &bitmap,
        "compress",
        "(Landroid/graphics/Bitmap$CompressFormat;ILjava/io/OutputStream;)Z",
        &[(&png).into(), 100.into(), (&output).into()],
    )?;
    let bytes = env.call_method(&output, "toByteArray", "()[B", &[])?.l()?;
    env.convert_byte_array(jni::objects::JByteArray::from(bytes))
        .map(Some)
}

#[tauri::command]
pub async fn read_clipboard_image_png(webview: Webview) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || read_image_png(&webview))
        .await
        .map_err(|error| error.to_string())??;

    Ok(Response::new(bytes))
}

#[cfg(all(test, desktop))]
mod tests {
    use super::encode_png;

    #[test]
    fn encodes_rgba_as_png() {
        let bytes = encode_png(&[255, 0, 0, 255], 1, 1).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }
}
