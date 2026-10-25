//! PDF export: the frontend harvests a display list in PDF points and Rust
//! renders it. On iOS, the finished file is staged for the system export picker.

mod contract;
mod fonts;
mod render;

use contract::PdfExportRequest;
use std::io::Write;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

#[tauri::command]
pub async fn export_pdf<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: PdfExportRequest,
    out_path: FilePath,
) -> Result<(), String> {
    // Rendering is CPU-bound; keep it off the async runtime so the webview stays
    // responsive.
    tokio::task::spawn_blocking(move || {
        let bytes = render::render(request)?;
        // Android picker destinations are content URIs, opened by the filesystem plugin.
        let mut file = app
            .fs()
            .open(
                out_path,
                OpenOptions::new()
                    .write(true)
                    .create(true)
                    .truncate(true)
                    .clone(),
            )
            .map_err(|e| format!("failed to open PDF destination: {e}"))?;
        file.write_all(&bytes)
            .map_err(|e| format!("failed to write PDF: {e}"))
    })
    .await
    .map_err(|e| format!("export task panicked: {e}"))?
}

#[tauri::command]
pub async fn export_pdf_ios(
    app: tauri::AppHandle,
    request: PdfExportRequest,
    suggested_name: String,
) -> Result<bool, String> {
    #[cfg(target_os = "ios")]
    {
        tokio::task::spawn_blocking(move || {
            let bytes = render::render(request)?;
            export_bytes_ios(&app, &suggested_name, &bytes)
        })
        .await
        .map_err(|e| format!("export task panicked: {e}"))?
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, request, suggested_name);
        Err("iOS PDF export is unavailable on this platform".into())
    }
}

#[tauri::command]
pub async fn export_file_ios(
    app: tauri::AppHandle,
    suggested_name: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    #[cfg(target_os = "ios")]
    {
        tokio::task::spawn_blocking(move || export_bytes_ios(&app, &suggested_name, &bytes))
            .await
            .map_err(|e| format!("export task panicked: {e}"))?
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, suggested_name, bytes);
        Err("iOS file export is unavailable on this platform".into())
    }
}

#[cfg(target_os = "ios")]
fn export_bytes_ios(
    app: &tauri::AppHandle,
    suggested_name: &str,
    bytes: &[u8],
) -> Result<bool, String> {
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;

    let documents = app
        .path()
        .document_dir()
        .map_err(|e| format!("failed to locate Documents: {e}"))?;
    // tauri-plugin-dialog 2.6 exports Documents/<file name> on iOS; without staging
    // there first, its picker sends an empty placeholder to Files.
    let (source, file_name) = stage_file(&documents, suggested_name, bytes)?;
    let saved = app
        .dialog()
        .file()
        .set_file_name(file_name)
        .blocking_save_file()
        .is_some();
    let _ = std::fs::remove_file(source);
    Ok(saved)
}

#[cfg(any(test, target_os = "ios"))]
fn stage_file(
    documents: &std::path::Path,
    suggested_name: &str,
    bytes: &[u8],
) -> Result<(std::path::PathBuf, String), String> {
    if suggested_name.is_empty()
        || std::path::Path::new(suggested_name).file_name()
            != Some(std::ffi::OsStr::new(suggested_name))
    {
        return Err("invalid export file name".into());
    }

    let name = std::path::Path::new(suggested_name);
    let stem = name.file_stem().unwrap().to_string_lossy();
    let extension = name
        .extension()
        .map(|ext| format!(".{}", ext.to_string_lossy()))
        .unwrap_or_default();
    let mut suffix = 1;
    loop {
        let file_name = if suffix == 1 {
            suggested_name.to_owned()
        } else {
            format!("{stem} ({suffix}){extension}")
        };
        let path = documents.join(&file_name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                if let Err(e) = file.write_all(bytes) {
                    let _ = std::fs::remove_file(&path);
                    return Err(format!("failed to stage export: {e}"));
                }
                return Ok((path, file_name));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => suffix += 1,
            Err(e) => return Err(format!("failed to stage export: {e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn export_writes_and_replaces_a_pdf_at_picker_paths() {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let path = std::env::temp_dir().join(format!("myelin-export-{}.pdf", uuid::Uuid::new_v4()));
        let request = || {
            serde_json::from_value::<PdfExportRequest>(serde_json::json!({
                "kind": "canvas",
                "pages": [{"widthPt": 100, "heightPt": 100, "items": []}]
            }))
            .unwrap()
        };
        export_pdf(app.handle().clone(), request(), path.clone().into())
            .await
            .unwrap();
        let expected = std::fs::read(&path).unwrap();
        assert!(expected.starts_with(b"%PDF-"));
        assert!(expected.ends_with(b"%%EOF"));

        std::fs::write(&path, vec![b'x'; expected.len() + 100]).unwrap();
        let url = tauri::Url::from_file_path(&path).unwrap();
        export_pdf(app.handle().clone(), request(), FilePath::Url(url))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), expected);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn staging_preserves_an_existing_document() {
        let documents =
            std::env::temp_dir().join(format!("myelin-pdf-export-{}", std::process::id()));
        std::fs::create_dir_all(&documents).unwrap();
        std::fs::write(documents.join("report.pdf"), b"existing").unwrap();

        let (source, file_name) = stage_file(&documents, "report.pdf", b"%PDF-1.7").unwrap();
        assert_eq!(file_name, "report (2).pdf");
        assert_eq!(std::fs::read(source).unwrap(), b"%PDF-1.7");
        assert_eq!(
            std::fs::read(documents.join("report.pdf")).unwrap(),
            b"existing"
        );
        assert!(stage_file(&documents, "../escape.pdf", b"%PDF-1.7").is_err());
        std::fs::write(documents.join("note.md"), b"existing markdown").unwrap();
        let (source, file_name) = stage_file(&documents, "note.md", b"# Note").unwrap();
        assert_eq!(file_name, "note (2).md");
        assert_eq!(std::fs::read(source).unwrap(), b"# Note");
        assert_eq!(
            std::fs::read(documents.join("note.md")).unwrap(),
            b"existing markdown"
        );
        std::fs::remove_dir_all(documents).unwrap();
    }
}
