use std::{
    ffi::OsStr,
    fs::OpenOptions,
    io::Write,
    path::{Component, Path},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn write_local_file_chunk(
    app: AppHandle,
    relative_path: String,
    write_id: String,
    offset: u64,
    bytes_base64: String,
    final_chunk: bool,
) -> Result<(), String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = STANDARD
            .decode(bytes_base64)
            .map_err(|error| error.to_string())?;
        write_chunk(
            &root,
            Path::new(&relative_path),
            &write_id,
            offset,
            &bytes,
            final_chunk,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn write_chunk(
    root: &Path,
    relative_path: &Path,
    write_id: &str,
    offset: u64,
    bytes: &[u8],
    final_chunk: bool,
) -> Result<(), String> {
    if relative_path.as_os_str().is_empty()
        || write_id.len() != 36
        || !write_id
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() || ch == '-')
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || (relative_path.file_name() != Some(OsStr::new("manifest.json"))
            && relative_path.parent().and_then(Path::file_name) != Some(OsStr::new("files")))
    {
        return Err("invalid local file path".into());
    }

    let path = root.join(relative_path);
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let parent = path
        .parent()
        .ok_or("invalid local file path")?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !parent.starts_with(root)
        || path
            .symlink_metadata()
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err("invalid local file path".into());
    }
    let staged = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .ok_or("invalid local file path")?
            .to_string_lossy(),
        write_id
    ));
    let mut file = OpenOptions::new()
        .append(true)
        .create_new(offset == 0)
        .open(&staged)
        .map_err(|error| error.to_string())?;
    if file.metadata().map_err(|error| error.to_string())?.len() != offset {
        return Err("local file write offset mismatch".into());
    }
    file.write_all(bytes).map_err(|error| error.to_string())?;
    if final_chunk {
        drop(file);
        std::fs::rename(staged, path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::write_chunk;
    use std::{fs, path::Path};

    #[test]
    fn writes_chunks_in_order_and_rejects_traversal() {
        let root = std::env::temp_dir().join(format!("myelin-file-write-{}", std::process::id()));
        fs::create_dir_all(root.join("files")).unwrap();
        let path = Path::new("files/note.myelin");
        let write_id = "12345678-1234-1234-1234-123456789abc";
        fs::write(root.join(path), b"original").unwrap();
        write_chunk(&root, path, write_id, 0, b"hello ", false).unwrap();
        assert_eq!(fs::read(root.join(path)).unwrap(), b"original");
        write_chunk(&root, path, write_id, 6, b"world", true).unwrap();
        assert_eq!(fs::read(root.join(path)).unwrap(), b"hello world");
        write_chunk(&root, Path::new("manifest.json"), write_id, 0, b"{}", true).unwrap();
        assert_eq!(fs::read(root.join("manifest.json")).unwrap(), b"{}");
        assert!(write_chunk(&root, path, write_id, 1, b"bad", true).is_err());
        assert!(write_chunk(
            &root,
            Path::new("../files/escape"),
            write_id,
            0,
            b"bad",
            true
        )
        .is_err());
        assert!(write_chunk(&root, path, "../../escape", 0, b"bad", true).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
