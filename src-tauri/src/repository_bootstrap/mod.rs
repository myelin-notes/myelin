pub(crate) mod download;
#[cfg(test)]
mod tests;

use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

pub(crate) struct CachePaths {
    pub(crate) cache: PathBuf,
}

impl CachePaths {
    pub(crate) fn new(app_data: &Path, storage_root: &str) -> Result<Self, String> {
        let parts: Vec<_> = storage_root.split('/').collect();
        if parts.len() != 3
            || parts[0] != "repositories"
            || !matches!(parts[1], "github" | "google-drive")
            || !valid_component(parts[2])
        {
            return Err("Invalid repository cache path".into());
        }
        fs::create_dir_all(app_data).map_err(io_error)?;
        let app_data = app_data.canonicalize().map_err(io_error)?;
        let mut parent = app_data.clone();
        for part in &parts[..2] {
            parent.push(part);
            reject_symlink(&parent)?;
            fs::create_dir_all(&parent).map_err(io_error)?;
            if !parent
                .canonicalize()
                .map_err(io_error)?
                .starts_with(&app_data)
            {
                return Err("Invalid repository cache path".into());
            }
        }
        let paths = Self {
            cache: parent.join(parts[2]),
        };
        reject_symlink(&paths.cache)?;
        Ok(paths)
    }
}

pub(crate) fn valid_component(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn io_error(error: std::io::Error) -> String {
    format!("Repository cache I/O failed: {error}")
}

pub(crate) fn reject_symlink(path: &Path) -> Result<(), String> {
    match path.symlink_metadata() {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("Invalid repository cache path".into())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

fn write_durable(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = File::create(path).map_err(io_error)?;
    file.write_all(bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)
}

pub(crate) fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(io_error)?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
