mod download;
#[cfg(test)]
mod tests;

use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use download::{download_repository, RepositorySource};

// ponytail: cache publication is globally serialized; use per-repository locks if it becomes contended.
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedRepositoryCache {
    stage_id: String,
    file_count: usize,
    byte_length: u64,
}

#[derive(Serialize, Deserialize)]
struct PreparedState {
    cache_fingerprint: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct InstallJournal {
    stage_id: String,
    had_cache: bool,
}

struct CachePaths {
    cache: PathBuf,
    backup: PathBuf,
    journal: PathBuf,
}

impl CachePaths {
    fn new(app_data: &Path, storage_root: &str) -> Result<Self, String> {
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
            backup: parent.join(format!(".{}.bootstrap-backup", parts[2])),
            journal: parent.join(format!(".{}.bootstrap.json", parts[2])),
        };
        for path in [&paths.cache, &paths.backup, &paths.journal] {
            reject_symlink(path)?;
        }
        Ok(paths)
    }

    fn stage(&self, stage_id: &str) -> Result<PathBuf, String> {
        if stage_id.len() != 36
            || !stage_id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        {
            return Err("Invalid repository cache stage".into());
        }
        let stage = self.cache.with_file_name(format!(
            ".{}.bootstrap-{stage_id}",
            self.cache
                .file_name()
                .ok_or("Invalid repository cache path")?
                .to_string_lossy()
        ));
        reject_symlink(&stage)?;
        Ok(stage)
    }
}

fn valid_component(value: &str) -> bool {
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

fn reject_symlink(path: &Path) -> Result<(), String> {
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

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(io_error)?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn sorted_entries(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries = fs::read_dir(path)
        .map_err(io_error)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(io_error)?;
    entries.sort();
    Ok(entries)
}

fn fingerprint_tree(path: &Path, hash: &mut Sha256) -> Result<(), String> {
    for child in sorted_entries(path)? {
        reject_symlink(&child)?;
        let metadata = child.metadata().map_err(io_error)?;
        let name = child
            .file_name()
            .ok_or("Invalid repository cache path")?
            .to_string_lossy();
        hash.update((name.len() as u64).to_le_bytes());
        hash.update(name.as_bytes());
        if metadata.is_dir() {
            hash.update(b"directory");
            fingerprint_tree(&child, hash)?;
        } else if metadata.is_file() {
            hash.update(metadata.len().to_le_bytes());
            let mut file = File::open(child).map_err(io_error)?;
            let mut bytes = [0; 64 * 1024];
            loop {
                let count = file.read(&mut bytes).map_err(io_error)?;
                if count == 0 {
                    break;
                }
                hash.update(&bytes[..count]);
            }
        } else {
            return Err("Invalid repository cache file".into());
        }
    }
    Ok(())
}

fn cache_fingerprint(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let mut hash = Sha256::new();
    fingerprint_tree(path, &mut hash)?;
    Ok(Some(format!("{:x}", hash.finalize())))
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    reject_symlink(source)?;
    if source.is_dir() {
        fs::create_dir(destination).map_err(io_error)?;
        for child in sorted_entries(source)? {
            copy_tree(
                &child,
                &destination.join(child.file_name().ok_or("Invalid repository cache path")?),
            )?;
        }
        sync_directory(destination)
    } else {
        fs::copy(source, destination).map_err(io_error)?;
        fs::OpenOptions::new()
            .write(true)
            .open(destination)
            .and_then(|file| file.sync_all())
            .map_err(io_error)
    }
}

fn remove_directory(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

fn recover_cache(paths: &CachePaths) -> Result<(), String> {
    if !paths.journal.exists() {
        return Ok(());
    }
    let journal: InstallJournal =
        serde_json::from_slice(&fs::read(&paths.journal).map_err(io_error)?)
            .map_err(|_| "Unreadable repository cache install journal")?;
    let stage = paths.stage(&journal.stage_id)?;
    if !paths.cache.exists() && paths.backup.exists() {
        fs::rename(&paths.backup, &paths.cache).map_err(io_error)?;
    } else if !paths.cache.exists() && journal.had_cache {
        return Err("Repository cache recovery requires its backup".into());
    }
    sync_directory(
        paths
            .cache
            .parent()
            .ok_or("Invalid repository cache path")?,
    )?;
    remove_directory(&paths.backup)?;
    remove_directory(&stage)?;
    fs::remove_file(&paths.journal).map_err(io_error)?;
    sync_directory(
        paths
            .cache
            .parent()
            .ok_or("Invalid repository cache path")?,
    )
}

fn has_pending_outbox(cache: &Path) -> Result<bool, String> {
    let path = cache.join("outbox.json");
    if !path.exists() {
        return Ok(false);
    }
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path).map_err(io_error)?)
        .map_err(|_| "Repository cache outbox requires recovery")?;
    value
        .as_array()
        .map(|entries| !entries.is_empty())
        .ok_or_else(|| "Repository cache outbox requires recovery".into())
}

fn install_cache(paths: &CachePaths, stage_id: &str) -> Result<bool, String> {
    recover_cache(paths)?;
    if paths.backup.exists() {
        return Err("Repository cache backup requires recovery".into());
    }
    let stage = paths.stage(stage_id)?;
    let prepared: PreparedState =
        serde_json::from_slice(&fs::read(stage.join(".prepared.json")).map_err(io_error)?)
            .map_err(|_| "Unreadable repository cache stage")?;
    if has_pending_outbox(&paths.cache)?
        || cache_fingerprint(&paths.cache)? != prepared.cache_fingerprint
    {
        return Ok(false);
    }
    if paths.cache.exists() {
        for child in sorted_entries(&paths.cache)? {
            if child
                .file_name()
                .is_some_and(|name| name == "manifest.json" || name == "files")
            {
                continue;
            }
            copy_tree(
                &child,
                &stage.join(child.file_name().ok_or("Invalid repository cache path")?),
            )?;
        }
    }
    fs::remove_file(stage.join(".prepared.json")).map_err(io_error)?;
    sync_directory(&stage.join("files"))?;
    sync_directory(&stage)?;
    let journal = InstallJournal {
        stage_id: stage_id.into(),
        had_cache: paths.cache.exists(),
    };
    let temporary_journal = paths.journal.with_extension("json.tmp");
    reject_symlink(&temporary_journal)?;
    write_durable(
        &temporary_journal,
        &serde_json::to_vec(&journal).map_err(|error| error.to_string())?,
    )?;
    fs::rename(temporary_journal, &paths.journal).map_err(io_error)?;
    let parent = paths
        .cache
        .parent()
        .ok_or("Invalid repository cache path")?;
    sync_directory(parent)?;
    let publish = (|| {
        if journal.had_cache {
            fs::rename(&paths.cache, &paths.backup).map_err(io_error)?;
            sync_directory(parent)?;
        }
        fs::rename(&stage, &paths.cache).map_err(io_error)?;
        sync_directory(parent)
    })();
    if let Err(error) = publish {
        recover_cache(paths)?;
        return Err(error);
    }
    // Once published, cleanup may be retried at the next startup without failing a successful install.
    let _ = recover_cache(paths);
    Ok(true)
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn recover_repository_cache(app: AppHandle, storage_root: String) -> Result<(), String> {
    let root = app_data(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = INSTALL_LOCK
            .lock()
            .map_err(|_| "Repository cache lock unavailable")?;
        recover_cache(&CachePaths::new(&root, &storage_root)?)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn prepare_repository_cache(
    app: AppHandle,
    storage_root: String,
    stage_id: String,
    source: RepositorySource,
) -> Result<PreparedRepositoryCache, String> {
    prepare_cache(
        &app_data(&app)?,
        &storage_root,
        &stage_id,
        source,
        &download::RemoteEndpoints::default(),
    )
    .await
}

async fn prepare_cache(
    root: &Path,
    storage_root: &str,
    stage_id: &str,
    source: RepositorySource,
    endpoints: &download::RemoteEndpoints,
) -> Result<PreparedRepositoryCache, String> {
    let root = root.to_owned();
    let storage_root = storage_root.to_owned();
    let stage_id = stage_id.to_owned();
    let prepare_id = stage_id.clone();
    let (stage, state) = tauri::async_runtime::spawn_blocking(move || {
        let _lock = INSTALL_LOCK
            .lock()
            .map_err(|_| "Repository cache lock unavailable")?;
        let paths = CachePaths::new(&root, &storage_root)?;
        let stage = paths.stage(&prepare_id)?;
        recover_cache(&paths)?;
        let state = PreparedState {
            cache_fingerprint: cache_fingerprint(&paths.cache)?,
        };
        fs::create_dir(&stage).map_err(io_error)?;
        fs::create_dir(stage.join("files")).map_err(io_error)?;
        Ok::<_, String>((stage, state))
    })
    .await
    .map_err(|error| error.to_string())??;
    let result = async {
        let (file_count, byte_length) = download_repository(&stage, source, endpoints).await?;
        let metadata_path = stage.join(".prepared.json");
        tauri::async_runtime::spawn_blocking(move || {
            write_durable(
                &metadata_path,
                &serde_json::to_vec(&state).map_err(|error| error.to_string())?,
            )
        })
        .await
        .map_err(|error| error.to_string())??;
        Ok(PreparedRepositoryCache {
            stage_id,
            file_count,
            byte_length,
        })
    }
    .await;
    if result.is_err() {
        let _ = tauri::async_runtime::spawn_blocking(move || remove_directory(&stage)).await;
    }
    result
}

#[tauri::command]
pub async fn install_repository_cache(
    app: AppHandle,
    storage_root: String,
    stage_id: String,
) -> Result<bool, String> {
    let root = app_data(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = INSTALL_LOCK
            .lock()
            .map_err(|_| "Repository cache lock unavailable")?;
        install_cache(&CachePaths::new(&root, &storage_root)?, &stage_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn discard_repository_cache(
    app: AppHandle,
    storage_root: String,
    stage_id: String,
) -> Result<(), String> {
    let root = app_data(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = INSTALL_LOCK
            .lock()
            .map_err(|_| "Repository cache lock unavailable")?;
        let paths = CachePaths::new(&root, &storage_root)?;
        recover_cache(&paths)?;
        remove_directory(&paths.stage(&stage_id)?)
    })
    .await
    .map_err(|error| error.to_string())?
}
