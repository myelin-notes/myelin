//! PDF export: the frontend harvests a display list in PDF points and Rust
//! renders it. On iOS, the finished file is staged for the system export picker.

mod contract;
mod fonts;
mod render;

use contract::PdfExportRequest;
use tauri_plugin_fs::FilePath;

#[tauri::command]
pub async fn export_pdf(request: PdfExportRequest, out_path: FilePath) -> Result<(), String> {
    // Rendering is CPU-bound; keep it off the async runtime so the webview stays
    // responsive.
    let bytes = tokio::task::spawn_blocking(move || render::render(request))
        .await
        .map_err(|e| format!("render task panicked: {e}"))??;
    let out_path = out_path
        .into_path()
        .map_err(|e| format!("invalid export path: {e}"))?;
    std::fs::write(&out_path, bytes)
        .map_err(|e| format!("failed to write {}: {e}", out_path.display()))?;
    Ok(())
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
            use tauri::Manager;
            use tauri_plugin_dialog::DialogExt;

            let bytes = render::render(request)?;
            let documents = app
                .path()
                .document_dir()
                .map_err(|e| format!("failed to locate Documents: {e}"))?;
            // tauri-plugin-dialog 2.6 exports Documents/<file name> on iOS; without staging
            // there first, its picker sends an empty placeholder to Files.
            let (source, file_name) = stage_pdf(&documents, &suggested_name, &bytes)?;
            let saved = app
                .dialog()
                .file()
                .set_file_name(file_name)
                .add_filter("PDF", &["pdf"])
                .blocking_save_file()
                .is_some();
            let _ = std::fs::remove_file(source);
            Ok(saved)
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

#[cfg(any(test, target_os = "ios"))]
fn stage_pdf(
    documents: &std::path::Path,
    suggested_name: &str,
    bytes: &[u8],
) -> Result<(std::path::PathBuf, String), String> {
    use std::io::Write;

    if suggested_name.is_empty()
        || std::path::Path::new(suggested_name).file_name()
            != Some(std::ffi::OsStr::new(suggested_name))
    {
        return Err("invalid PDF file name".into());
    }

    let stem = suggested_name
        .strip_suffix(".pdf")
        .unwrap_or(suggested_name);
    let mut suffix = 1;
    loop {
        let file_name = if suffix == 1 {
            suggested_name.to_owned()
        } else {
            format!("{stem} ({suffix}).pdf")
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
                    return Err(format!("failed to stage PDF: {e}"));
                }
                return Ok((path, file_name));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => suffix += 1,
            Err(e) => return Err(format!("failed to stage PDF: {e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staging_preserves_an_existing_document() {
        let documents =
            std::env::temp_dir().join(format!("myelin-pdf-export-{}", std::process::id()));
        std::fs::create_dir_all(&documents).unwrap();
        std::fs::write(documents.join("report.pdf"), b"existing").unwrap();

        let (source, file_name) = stage_pdf(&documents, "report.pdf", b"%PDF-1.7").unwrap();
        assert_eq!(file_name, "report (2).pdf");
        assert_eq!(std::fs::read(source).unwrap(), b"%PDF-1.7");
        assert_eq!(
            std::fs::read(documents.join("report.pdf")).unwrap(),
            b"existing"
        );
        assert!(stage_pdf(&documents, "../escape.pdf", b"%PDF-1.7").is_err());
        std::fs::remove_dir_all(documents).unwrap();
    }
}
