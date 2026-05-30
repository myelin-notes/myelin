//! PDF export: the frontend harvests a display list (coordinates already in PDF
//! points), Rust renders it with krilla and writes the result to disk directly.
//! Fire-and-forget — no bytes are returned over IPC.

mod contract;
mod fonts;
mod render;

use contract::PdfExportRequest;

#[tauri::command]
pub async fn export_pdf(request: PdfExportRequest, out_path: String) -> Result<(), String> {
    // Rendering is CPU-bound; keep it off the async runtime so the webview stays
    // responsive.
    let bytes = tokio::task::spawn_blocking(move || render::render(request))
        .await
        .map_err(|e| format!("render task panicked: {e}"))??;
    std::fs::write(&out_path, bytes).map_err(|e| format!("failed to write {out_path}: {e}"))?;
    Ok(())
}
