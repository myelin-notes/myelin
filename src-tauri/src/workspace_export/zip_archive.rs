//! Workspace JSON export: writes the planned export as a single `.zip` in the
//! user-picked directory instead of a folder tree. Everything is nested under
//! one top-level folder named after the archive, so extracting the zip yields a
//! tidy folder rather than loose files, and the importer can recover the name.

use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

#[cfg(test)]
use super::VaultFile;
use super::{safe_segments, VaultExportRequest};

#[tauri::command]
pub async fn export_workspace_zip(request: VaultExportRequest) -> Result<String, String> {
    // Filesystem work is blocking; keep it off the async runtime.
    tokio::task::spawn_blocking(move || write_zip(request))
        .await
        .map_err(|e| format!("export task panicked: {e}"))?
}

/// The export name must be usable both as a file name and as the archive's root
/// folder, so require it to be exactly one safe path segment.
fn archive_name(vault_name: &str) -> Result<&str, String> {
    match safe_segments(vault_name)?.as_slice() {
        [single] => Ok(single),
        _ => Err(format!("invalid export name {vault_name}")),
    }
}

/// Pick a free `<name>.zip` in `dest_dir`, appending ` (2)`, ` (3)`… on
/// collision. Returns the path and the stem, which doubles as the archive root.
fn resolve_zip_path(dest_dir: &str, name: &str) -> (PathBuf, String) {
    let dest = Path::new(dest_dir);
    let mut stem = name.to_string();
    let mut suffix = 2;
    while dest.join(format!("{stem}.zip")).exists() {
        stem = format!("{name} ({suffix})");
        suffix += 1;
    }
    (dest.join(format!("{stem}.zip")), stem)
}

fn write_zip(request: VaultExportRequest) -> Result<String, String> {
    let name = archive_name(&request.vault_name)?;
    let (zip_path, root) = resolve_zip_path(&request.dest_dir, name);
    match write_archive(&zip_path, &root, &request) {
        Ok(()) => Ok(zip_path.to_string_lossy().into_owned()),
        Err(error) => {
            // Roll back the partial archive so a failed export does not leave a
            // truncated, unreadable zip behind.
            let _ = std::fs::remove_file(&zip_path);
            Err(error)
        }
    }
}

/// Prefix a validated relative path with the archive root, '/'-separated as the
/// zip format requires.
fn entry_name(root: &str, rel: &str) -> Result<String, String> {
    let mut name = root.to_string();
    for segment in safe_segments(rel)? {
        name.push('/');
        name.push_str(segment);
    }
    Ok(name)
}

fn write_archive(zip_path: &Path, root: &str, request: &VaultExportRequest) -> Result<(), String> {
    let file = File::create(zip_path)
        .map_err(|e| format!("failed to create {}: {e}", zip_path.display()))?;
    let mut writer = ZipWriter::new(BufWriter::new(file));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // Directory entries preserve empty folders, which file entries alone cannot.
    writer
        .add_directory(root, options)
        .map_err(|e| format!("failed to add {root}: {e}"))?;
    for folder in &request.folders {
        let name = entry_name(root, folder)?;
        writer
            .add_directory(&name, options)
            .map_err(|e| format!("failed to add {name}: {e}"))?;
    }

    for file in &request.files {
        let name = entry_name(root, &file.rel_path)?;
        writer
            .start_file(&name, options)
            .map_err(|e| format!("failed to add {name}: {e}"))?;

        if let Some(text) = &file.text {
            writer
                .write_all(text.as_bytes())
                .map_err(|e| format!("failed to write {name}: {e}"))?;
        } else if let Some(source) = &file.copy_from {
            let mut reader = BufReader::new(
                File::open(source).map_err(|e| format!("failed to open {source}: {e}"))?,
            );
            std::io::copy(&mut reader, &mut writer)
                .map_err(|e| format!("failed to copy {source} into {name}: {e}"))?;
        }
    }

    let mut inner = writer
        .finish()
        .map_err(|e| format!("failed to finish {}: {e}", zip_path.display()))?;
    inner
        .flush()
        .map_err(|e| format!("failed to flush {}: {e}", zip_path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_name_nests_under_the_archive_root() {
        assert_eq!(
            entry_name("Export", "Notes/Daily/Today.json").expect("legit path rejected"),
            "Export/Notes/Daily/Today.json"
        );
    }

    #[test]
    fn entry_name_rejects_escaping_paths() {
        for malicious in ["..", "a/../b", "C:\\Windows", "C:evil"] {
            assert!(
                entry_name("Export", malicious).is_err(),
                "expected rejection for {malicious:?}"
            );
        }
    }

    /// Write a real archive and read it back, pinning the layout the importer
    /// relies on: one root folder, empty folders kept, media copied verbatim.
    #[test]
    fn writes_an_archive_the_importer_can_read() {
        let dir = std::env::temp_dir().join(format!("myelin-zip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let media_source = dir.join("source.png");
        std::fs::write(&media_source, [0u8, 1, 2, 255]).expect("media source");

        let request = VaultExportRequest {
            dest_dir: dir.to_string_lossy().into_owned(),
            vault_name: "My Export".to_string(),
            folders: vec!["Sub".to_string(), "Empty".to_string()],
            files: vec![
                VaultFile {
                    rel_path: "Sub/Note.json".to_string(),
                    text: Some("{\"version\":1}".to_string()),
                    copy_from: None,
                },
                VaultFile {
                    rel_path: "Pic.png".to_string(),
                    text: None,
                    copy_from: Some(media_source.to_string_lossy().into_owned()),
                },
            ],
        };

        let zip_path = write_zip(request).expect("export failed");
        assert!(zip_path.ends_with("My Export.zip"), "unexpected {zip_path}");

        let mut archive = zip::ZipArchive::new(std::io::BufReader::new(
            File::open(&zip_path).expect("open archive"),
        ))
        .expect("read archive");
        let names: Vec<String> = archive.file_names().map(str::to_string).collect();
        assert!(names.contains(&"My Export/Empty/".to_string()), "{names:?}");
        assert!(
            names.contains(&"My Export/Sub/Note.json".to_string()),
            "{names:?}"
        );

        let mut media = Vec::new();
        std::io::Read::read_to_end(
            &mut archive.by_name("My Export/Pic.png").expect("media entry"),
            &mut media,
        )
        .expect("read media");
        assert_eq!(media, [0u8, 1, 2, 255]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn archive_name_requires_a_single_segment() {
        assert_eq!(
            archive_name("My Export").expect("legit name rejected"),
            "My Export"
        );
        for malicious in ["", "a/b", "..", "C:"] {
            assert!(
                archive_name(malicious).is_err(),
                "expected rejection for {malicious:?}"
            );
        }
    }
}
