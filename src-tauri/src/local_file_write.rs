use std::{
    ffi::OsStr,
    fs::OpenOptions,
    io::{Seek, SeekFrom, Write},
    path::{Component, Path},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Manager};

#[tauri::command(async)]
pub fn write_local_file_chunk(
    app: AppHandle,
    relative_path: String,
    offset: u64,
    bytes_base64: String,
) -> Result<(), String> {
    let bytes = STANDARD
        .decode(bytes_base64)
        .map_err(|error| error.to_string())?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    write_chunk(&root, Path::new(&relative_path), offset, &bytes)
}

fn write_chunk(root: &Path, relative_path: &Path, offset: u64, bytes: &[u8]) -> Result<(), String> {
    if relative_path.as_os_str().is_empty()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || relative_path.parent().and_then(Path::file_name) != Some(OsStr::new("files"))
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
    let mut file = OpenOptions::new()
        .write(true)
        .create(offset == 0)
        .truncate(offset == 0)
        .open(path)
        .map_err(|error| error.to_string())?;
    if offset > 0 {
        if file.metadata().map_err(|error| error.to_string())?.len() != offset {
            return Err("local file write offset mismatch".into());
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
    }
    file.write_all(bytes).map_err(|error| error.to_string())
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
        write_chunk(&root, path, 0, b"hello ").unwrap();
        write_chunk(&root, path, 6, b"world").unwrap();
        assert_eq!(fs::read(root.join(path)).unwrap(), b"hello world");
        assert!(write_chunk(&root, path, 1, b"bad").is_err());
        assert!(write_chunk(&root, Path::new("../files/escape"), 0, b"bad").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
