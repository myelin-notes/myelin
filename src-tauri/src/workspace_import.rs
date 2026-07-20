//! Workspace ZIP import, the read side of [`crate::workspace_export`].
//!
//! The renderer lists the archive's entries, builds its whole import preview
//! from that listing alone, then pulls one entry's bytes at a time as it writes
//! each note or media file. Decompressing the archive in the renderer instead
//! would hold the compressed bytes plus every decompressed entry in memory at
//! once, which a media-heavy workspace cannot afford.

use std::fs::File;
use std::io::{BufReader, Read};

use serde::Serialize;
use zip::ZipArchive;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipEntry {
    /// Entry name exactly as stored, '/'-separated; the renderer normalizes it.
    path: String,
    is_dir: bool,
}

#[tauri::command]
pub async fn scan_workspace_zip(zip_path: String) -> Result<Vec<ZipEntry>, String> {
    // Filesystem work is blocking; keep it off the async runtime.
    tokio::task::spawn_blocking(move || list_entries(&zip_path))
        .await
        .map_err(|e| format!("scan task panicked: {e}"))?
}

/// Decompress a single entry. Returned as a raw IPC response so the bytes reach
/// the renderer as an ArrayBuffer rather than a JSON number array.
#[tauri::command]
pub async fn read_workspace_zip_entry(
    zip_path: String,
    entry_path: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes = tokio::task::spawn_blocking(move || read_entry(&zip_path, &entry_path))
        .await
        .map_err(|e| format!("read task panicked: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Each read reparses the central directory, which costs a fraction of a
/// millisecond per call against writing the file it is fetching. Caching the
/// open archive would mean holding a file handle across the whole import, and
/// on Windows that blocks the user from deleting the zip afterwards.
fn open(zip_path: &str) -> Result<ZipArchive<BufReader<File>>, String> {
    let file = File::open(zip_path).map_err(|e| format!("failed to open {zip_path}: {e}"))?;
    ZipArchive::new(BufReader::new(file)).map_err(|e| format!("failed to read {zip_path}: {e}"))
}

fn list_entries(zip_path: &str) -> Result<Vec<ZipEntry>, String> {
    let archive = open(zip_path)?;
    Ok(archive
        .file_names()
        .map(|name| ZipEntry {
            path: name.to_string(),
            is_dir: name.ends_with('/'),
        })
        .collect())
}

fn read_entry(zip_path: &str, entry_path: &str) -> Result<Vec<u8>, String> {
    let mut archive = open(zip_path)?;
    let mut entry = archive
        .by_name(entry_path)
        .map_err(|e| format!("failed to find {entry_path} in {zip_path}: {e}"))?;

    // Deliberately not `with_capacity(entry.size())`: the size comes from the
    // archive's own header, so trusting it would let a malformed zip ask for an
    // arbitrary allocation before a single byte is decompressed.
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|e| format!("failed to read {entry_path} from {zip_path}: {e}"))?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Write a small archive, then list and read it back the way import does.
    #[test]
    fn lists_entries_and_reads_one_at_a_time() {
        let dir = std::env::temp_dir().join(format!("myelin-unzip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let zip_path = dir.join("Workspace.zip");

        {
            let mut writer = zip::ZipWriter::new(File::create(&zip_path).expect("create archive"));
            let options = zip::write::SimpleFileOptions::default();
            writer
                .add_directory("Workspace/Empty", options)
                .expect("dir");
            writer
                .start_file("Workspace/Note.json", options)
                .expect("note");
            std::io::Write::write_all(&mut writer, b"{\"version\":1}").expect("write note");
            writer
                .start_file("Workspace/Pic.png", options)
                .expect("media");
            std::io::Write::write_all(&mut writer, &[0u8, 1, 2, 255]).expect("write media");
            writer.finish().expect("finish");
        }

        let path = zip_path.to_string_lossy().into_owned();
        let entries = list_entries(&path).expect("list failed");
        let dirs: Vec<&str> = entries
            .iter()
            .filter(|entry| entry.is_dir)
            .map(|entry| entry.path.as_str())
            .collect();
        assert_eq!(dirs, ["Workspace/Empty/"]);

        assert_eq!(
            read_entry(&path, "Workspace/Note.json").expect("read note"),
            b"{\"version\":1}"
        );
        assert_eq!(
            read_entry(&path, "Workspace/Pic.png").expect("read media"),
            [0u8, 1, 2, 255]
        );
        assert!(read_entry(&path, "Workspace/Missing.json").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
