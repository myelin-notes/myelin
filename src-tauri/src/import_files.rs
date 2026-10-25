use serde::Deserialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::{FilePath, FsExt};

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum FileImportSource {
    Path { path: FilePath },
    Scoped { folder_id: String, path: String },
}

fn validate_path<R: Runtime>(app: &AppHandle<R>, path: &FilePath) -> Result<(), String> {
    if let Ok(path) = path.clone().into_path() {
        if app.fs_scope().is_allowed(&path) {
            return Ok(());
        }
        return Err("Import source is outside the selected filesystem scope".into());
    }
    #[cfg(target_os = "android")]
    if matches!(path, FilePath::Url(url) if url.scheme() == "content") {
        // Android enforces the URI grant when the filesystem plugin opens it.
        return Ok(());
    }
    Err("Unsupported import source URI".into())
}

impl FileImportSource {
    pub fn read<R: Runtime>(self, app: &AppHandle<R>) -> Result<Vec<u8>, String> {
        match self {
            Self::Path { path } => {
                validate_path(app, &path)?;
                app.fs().read(path).map_err(|error| error.to_string())
            }
            Self::Scoped { folder_id, path } => {
                #[cfg(mobile)]
                {
                    tauri_plugin_scoped_storage::read_file(
                        app.clone(),
                        tauri_plugin_scoped_storage::ReadFileRequest { folder_id, path },
                    )
                    .map(|response| response.data)
                    .map_err(|error| error.to_string())
                }
                #[cfg(desktop)]
                {
                    let _ = (folder_id, path);
                    Err("Scoped folder imports require a mobile platform".into())
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_sources_read_only_selected_files_and_reject_other_uris() {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let path = std::env::temp_dir().join(format!("myelin-import-{}.png", uuid::Uuid::new_v4()));
        let bytes: Vec<u8> = (0..20000).map(|i| (i % 251) as u8).collect();
        std::fs::write(&path, &bytes).unwrap();
        let source = || FileImportSource::Path {
            path: path.clone().into(),
        };
        assert!(source().read(app.handle()).is_err());
        app.fs_scope().allow_file(&path).unwrap();
        assert_eq!(source().read(app.handle()).unwrap(), bytes);
        std::fs::remove_file(&path).unwrap();
        assert!(source().read(app.handle()).is_err());
        assert!(FileImportSource::Path {
            path: "https://example.com/image.png".parse().unwrap()
        }
        .read(app.handle())
        .is_err());
    }
}

#[tauri::command]
pub async fn import_file_name(app: AppHandle, path: FilePath) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        validate_path(&app, &path)?;
        #[cfg(target_os = "android")]
        if let FilePath::Url(url) = &path {
            if url.scheme() == "content" {
                return tauri_plugin_scoped_storage::file_name(&app, url.to_string())
                    .map_err(|error| error.to_string());
            }
        }
        path.into_path()
            .map_err(|error| error.to_string())?
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_owned)
            .ok_or_else(|| "File name unavailable".into())
    })
    .await
    .map_err(|error| error.to_string())?
}
