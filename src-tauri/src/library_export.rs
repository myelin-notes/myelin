//! Writes a library export tree to a user-chosen directory.
//!
//! The JS side generates Markdown for notes and resolves on-disk source paths
//! for media; Rust performs the filesystem writes directly. Doing the writes
//! here (rather than through `tauri-plugin-fs`) keeps the export off the fs
//! scope, so it can target any folder the user picked without granting the
//! webview broad write permissions.

use std::path::{Component, Path, PathBuf};

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExportEntry {
    /// Create an (possibly empty) directory.
    Dir { path: String },
    /// Write a UTF-8 text file (Markdown notes).
    Text { path: String, content: String },
    /// Copy an existing file (images, video) into the export tree.
    Copy { path: String, source: String },
}

#[tauri::command]
pub fn export_library(root: String, entries: Vec<ExportEntry>) -> Result<(), String> {
    let root = PathBuf::from(&root);
    for entry in entries {
        match entry {
            ExportEntry::Dir { path } => {
                let dest = resolve(&root, &path)?;
                create_dir_all(&dest)?;
            }
            ExportEntry::Text { path, content } => {
                let dest = resolve(&root, &path)?;
                ensure_parent(&dest)?;
                std::fs::write(&dest, content)
                    .map_err(|e| format!("failed to write {}: {e}", dest.display()))?;
            }
            ExportEntry::Copy { path, source } => {
                let dest = resolve(&root, &path)?;
                ensure_parent(&dest)?;
                std::fs::copy(&source, &dest)
                    .map_err(|e| format!("failed to copy {source} to {}: {e}", dest.display()))?;
            }
        }
    }
    Ok(())
}

fn ensure_parent(dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        create_dir_all(parent)?;
    }
    Ok(())
}

fn create_dir_all(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("failed to create {}: {e}", dir.display()))
}

/// Join a relative export path onto `root`, rejecting any parent (`..`),
/// root, or prefix component so a crafted name can't escape the chosen folder.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel);
    for component in rel.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(format!("unsafe export path: {}", rel.display()));
        }
    }
    Ok(root.join(rel))
}
