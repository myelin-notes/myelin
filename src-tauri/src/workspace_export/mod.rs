//! Obsidian vault export: the frontend plans the vault (a folder list plus, per
//! file, either the markdown body to write or a local source path to copy) and
//! Rust writes it into the user-picked destination directly with `std::fs`.
//! This bypasses the fs-plugin scope the same way `pdf_export` does, so the user
//! can export anywhere they pick without granting broad filesystem write access.

use std::path::{Path, PathBuf};

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFile {
    /// Destination path relative to the vault root, '/'-separated.
    rel_path: String,
    /// Markdown body for note files.
    text: Option<String>,
    /// Absolute source path to copy verbatim (media stored locally).
    copy_from: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultExportRequest {
    dest_dir: String,
    vault_name: String,
    /// Relative directories to create up front (preserves empty folders).
    folders: Vec<String>,
    files: Vec<VaultFile>,
}

#[tauri::command]
pub async fn export_obsidian_vault(request: VaultExportRequest) -> Result<String, String> {
    // Filesystem work is blocking; keep it off the async runtime.
    tokio::task::spawn_blocking(move || write_vault(request))
        .await
        .map_err(|e| format!("export task panicked: {e}"))?
}

/// Join a '/'-separated relative path onto `root`, rejecting any segment that
/// would escape the vault (`..`, absolute paths).
fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    for segment in rel.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." || segment.contains('\\') {
            return Err(format!("unsafe path segment in {rel}"));
        }
        path.push(segment);
    }
    Ok(path)
}

fn resolve_vault_dir(dest_dir: &str, vault_name: &str) -> PathBuf {
    let dest = Path::new(dest_dir);
    let mut candidate = dest.join(vault_name);
    let mut suffix = 2;
    while candidate.exists() {
        candidate = dest.join(format!("{vault_name} ({suffix})"));
        suffix += 1;
    }
    candidate
}

fn write_vault(request: VaultExportRequest) -> Result<String, String> {
    let vault_dir = resolve_vault_dir(&request.dest_dir, &request.vault_name);
    match write_entries(&vault_dir, &request) {
        Ok(()) => Ok(vault_dir.to_string_lossy().into_owned()),
        Err(error) => {
            // Roll back the partially written vault so a failed export does not
            // leave a half-populated folder behind.
            let _ = std::fs::remove_dir_all(&vault_dir);
            Err(error)
        }
    }
}

fn write_entries(vault_dir: &Path, request: &VaultExportRequest) -> Result<(), String> {
    std::fs::create_dir_all(vault_dir)
        .map_err(|e| format!("failed to create {}: {e}", vault_dir.display()))?;

    for folder in &request.folders {
        let dir = safe_join(vault_dir, folder)?;
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    }

    for file in &request.files {
        let path = safe_join(vault_dir, &file.rel_path)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
        }

        if let Some(text) = &file.text {
            std::fs::write(&path, text)
                .map_err(|e| format!("failed to write {}: {e}", path.display()))?;
        } else if let Some(source) = &file.copy_from {
            std::fs::copy(source, &path)
                .map_err(|e| format!("failed to copy {source} to {}: {e}", path.display()))?;
        }
    }

    Ok(())
}
