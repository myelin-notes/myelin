use super::{
    document,
    store::{file_name, migrate, now, FileWrite, Store, SyncState},
    Changes, RepositoryEngine, RepositoryManager,
};
use crate::{
    github_push::{GitPushFile, GitPushRequest},
    repository_bootstrap::download::{
        self, endpoint, find_drive, require_success, DriveEntry, RemoteClient, RemoteEndpoints,
        RepositorySource,
    },
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::atomic::Ordering,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_http::reqwest::Method;

#[derive(Clone)]
struct Snapshot {
    manifest: Value,
    files: HashMap<String, Vec<u8>>,
    sync: SyncState,
}

struct Captured {
    snapshot: Snapshot,
    operations: Vec<Value>,
}
struct Plan {
    snapshot: Snapshot,
    additions: HashMap<String, Vec<u8>>,
    deletions: Vec<String>,
}

impl Snapshot {
    fn read(root: &Path) -> Result<Self, String> {
        let mut manifest = download::parse_manifest(
            &std::fs::read(root.join("manifest.json")).map_err(|error| error.to_string())?,
        )?;
        migrate(&mut manifest);
        let mut files = HashMap::new();
        let mut revisions = HashMap::new();
        let mut file_ids = HashMap::new();
        let head = match std::fs::read_to_string(root.join(".remote-revision")) {
            Ok(head) => Some(head),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.to_string()),
        };
        let drive: HashMap<String, DriveEntry> =
            match std::fs::read(root.join(".remote-drive.json")) {
                Ok(bytes) => serde_json::from_slice(&bytes)
                    .map_err(|_| "Unreadable Google Drive revisions")?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
                Err(error) => return Err(error.to_string()),
            };
        for (id, node) in manifest["nodes"]
            .as_object()
            .ok_or("Invalid repository manifest")?
        {
            if node["type"] != "file" {
                continue;
            }
            let name = file_name(node)?;
            let bytes =
                std::fs::read(root.join("files").join(&name)).map_err(|error| error.to_string())?;
            let revision = if head.is_some() {
                Some(blob_sha(&bytes)?)
            } else {
                drive
                    .get(&name)
                    .and_then(|entry| entry.head_revision_id.clone())
            };
            if let Some(entry) = drive.get(&name) {
                file_ids.insert(id.clone(), entry.id.clone());
            }
            files.insert(id.clone(), bytes);
            revisions.insert(id.clone(), revision);
        }
        let drive_head = drive
            .get("manifest.json")
            .and_then(|entry| entry.head_revision_id.clone());
        Ok(Self {
            manifest,
            files,
            sync: SyncState {
                last_remote_sync_at: None,
                head_revision: head.or(drive_head),
                file_revisions: revisions,
                basis_id: None,
                file_ids,
                document_generations: HashMap::new(),
            },
        })
    }

    fn save_basis(&mut self, cache: &Path) -> Result<(), String> {
        let id = uuid::Uuid::new_v4().to_string();
        let root = cache.join(&id);
        std::fs::create_dir_all(root.join("files")).map_err(|error| error.to_string())?;
        for (id, bytes) in &self.files {
            if self.manifest["nodes"][id]["type"] != "file" {
                continue;
            }
            super::store::atomic_write(
                &root
                    .join("files")
                    .join(file_name(&self.manifest["nodes"][id])?),
                bytes,
            )?;
        }
        super::store::atomic_write(
            &root.join("manifest.json"),
            &serde_json::to_vec(&self.manifest).map_err(|error| error.to_string())?,
        )?;
        self.sync.basis_id = Some(id);
        super::store::atomic_write(
            &root.join("sync.json"),
            &serde_json::to_vec(&self.sync).map_err(|error| error.to_string())?,
        )
    }

    fn read_basis(cache: &Path, sync: &SyncState) -> Result<Option<Self>, String> {
        let Some(id) = &sync.basis_id else {
            return Ok(None);
        };
        if !crate::repository_bootstrap::valid_component(id) {
            return Err("Invalid native remote basis".into());
        }
        let root = cache.join(id);
        if !root.join("manifest.json").exists() {
            return Ok(None);
        }
        let manifest = download::parse_manifest(
            &std::fs::read(root.join("manifest.json")).map_err(|error| error.to_string())?,
        )?;
        let saved: SyncState = serde_json::from_slice(
            &std::fs::read(root.join("sync.json")).map_err(|error| error.to_string())?,
        )
        .map_err(|_| "Invalid native remote basis")?;
        if saved.head_revision != sync.head_revision {
            return Ok(None);
        }
        let mut files = HashMap::new();
        for (id, node) in manifest["nodes"].as_object().unwrap() {
            if node["type"] == "file" {
                files.insert(
                    id.clone(),
                    std::fs::read(root.join("files").join(file_name(node)?))
                        .map_err(|error| error.to_string())?,
                );
            }
        }
        Ok(Some(Self {
            manifest,
            files,
            sync: saved,
        }))
    }
}

fn blob_sha(bytes: &[u8]) -> Result<String, String> {
    git2::Oid::hash_object(git2::ObjectType::Blob, bytes)
        .map(|oid| oid.to_string())
        .map_err(|_| "GitHub blob revision unavailable".into())
}

fn capture(store: &mut Store) -> Result<Captured, String> {
    if let Some(error) = &store.recovery_error {
        return Err(error.clone());
    }
    let mut files = HashMap::new();
    for op in &store.outbox {
        if op["kind"] != "push-note" {
            continue;
        }
        let id = op["nodeId"]
            .as_str()
            .ok_or("Invalid queued repository file")?;
        let node = &store.manifest["nodes"][id];
        if node["type"] == "file" {
            files.insert(id.into(), store.read_file(node)?);
        }
    }
    Ok(Captured {
        snapshot: Snapshot {
            manifest: store.manifest.clone(),
            files,
            sync: store.sync.clone(),
        },
        operations: store.outbox.clone(),
    })
}

fn replay(manifest: &mut Value, local: &Value, operations: &[Value]) -> Result<(), String> {
    for op in operations {
        let id = op["nodeId"].as_str().unwrap_or("");
        match op["kind"].as_str() {
            Some("upsert-manifest-node" | "push-note") => {
                if local["nodes"][id].is_null() {
                    continue;
                }
                let mut pending = vec![id.to_owned()];
                let mut visited = HashSet::new();
                while let Some(id) = pending.pop() {
                    if !visited.insert(id.clone()) {
                        return Err("Repository folder ancestry contains a cycle".into());
                    }
                    let node = &local["nodes"][&id];
                    if node.is_null() {
                        continue;
                    }
                    if let Some(parent) = node["parentId"].as_str() {
                        if manifest["nodes"][parent].is_null() {
                            pending.push(parent.into());
                        }
                    }
                    manifest["nodes"][&id] = node.clone();
                    if let Some(parent) = node["parentId"].as_str() {
                        if local["nodes"][parent].is_null() && manifest["nodes"][parent].is_null() {
                            manifest["nodes"][&id]["parentId"] = Value::Null;
                        }
                    }
                    if local["linksBySource"][&id].is_null() {
                        manifest["linksBySource"]
                            .as_object_mut()
                            .unwrap()
                            .remove(&id);
                    } else {
                        manifest["linksBySource"][&id] = local["linksBySource"][&id].clone();
                    }
                }
            }
            Some("delete-manifest-node") => {
                let mut removed = HashSet::from([id.to_owned()]);
                loop {
                    let before = removed.len();
                    for (id, node) in manifest["nodes"].as_object().unwrap() {
                        if node["parentId"]
                            .as_str()
                            .is_some_and(|parent| removed.contains(parent))
                        {
                            removed.insert(id.clone());
                        }
                    }
                    if before == removed.len() {
                        break;
                    }
                }
                for id in removed {
                    manifest["nodes"].as_object_mut().unwrap().remove(&id);
                    manifest["linksBySource"]
                        .as_object_mut()
                        .unwrap()
                        .remove(&id);
                }
            }
            Some("sync-custom-colors") => manifest["colors"] = local["colors"].clone(),
            Some("sync-tag-registry") => manifest["tagRegistry"] = local["tagRegistry"].clone(),
            Some("sync-pen-presets") => manifest["penPresets"] = local["penPresets"].clone(),
            _ => return Err("Invalid cached repository operation".into()),
        }
    }
    Ok(())
}

fn plan(captured: &Captured, mut remote: Snapshot) -> Result<Plan, String> {
    let previous = remote.manifest.clone();
    replay(
        &mut remote.manifest,
        &captured.snapshot.manifest,
        &captured.operations,
    )?;
    let mut additions = HashMap::new();
    for op in &captured.operations {
        if op["kind"] != "push-note" {
            continue;
        }
        let id = op["nodeId"].as_str().ok_or("Invalid cached note ID")?;
        let node = captured.snapshot.manifest["nodes"][id].clone();
        if node["type"] != "file" || remote.manifest["nodes"][id].is_null() {
            continue;
        }
        let local = captured
            .snapshot
            .files
            .get(id)
            .ok_or("Queued repository file is missing")?;
        let old = remote.files.get(id).map(Vec::as_slice).unwrap_or_default();
        let replacement = op["replaceFile"] == true;
        let bytes = if node["fileType"] == "mcanvas" {
            if replacement {
                local.clone()
            } else {
                document::merge(old, local)?
            }
        } else {
            let base = op.get("baseFileRevision").cloned().unwrap_or(Value::Null);
            let current = if old.is_empty() {
                Value::Null
            } else {
                json!(super::store::revision(old))
            };
            if !replacement && base != current && old != local {
                let conflict_id = format!(
                    "conflict-{}",
                    op["queueRevision"]
                        .as_str()
                        .ok_or("Missing queued revision")?
                );
                let mut conflict = node.clone();
                conflict["id"] = json!(conflict_id);
                let date = chrono::DateTime::from_timestamp_millis(
                    node["modifiedAt"].as_i64().unwrap_or(0),
                )
                .unwrap_or_default()
                .with_timezone(&chrono::Local);
                let name = node["name"].as_str().unwrap_or("File");
                let suffix = format!(" (Conflicted copy {})", date.format("%Y%m%d%H%M"));
                conflict["name"] = json!(match name
                    .rfind('.')
                    .filter(|index| *index > 0 && *index + 1 < name.len())
                {
                    Some(index) => format!("{}{suffix}{}", &name[..index], &name[index..]),
                    None => format!("{name}{suffix}"),
                });
                if previous["nodes"][id]["type"] == "file" {
                    remote.manifest["nodes"][id] = previous["nodes"][id].clone();
                } else {
                    remote.manifest["nodes"].as_object_mut().unwrap().remove(id);
                }
                remote.manifest["nodes"][&conflict_id] = conflict.clone();
                additions.insert(format!("files/{}", file_name(&conflict)?), local.clone());
                remote.files.insert(conflict_id, local.clone());
                continue;
            }
            local.clone()
        };
        if old != bytes {
            additions.insert(format!("files/{}", file_name(&node)?), bytes.clone());
        }
        remote.files.insert(id.into(), bytes.clone());
        if node["fileType"] == "mcanvas" && node["system"].is_null() {
            let links = document::links(&document::decode(&bytes)?);
            if links.is_empty() {
                remote.manifest["linksBySource"]
                    .as_object_mut()
                    .unwrap()
                    .remove(id);
            } else {
                remote.manifest["linksBySource"][id] = json!(links);
            }
        }
    }
    let mut deletions = Vec::new();
    for (id, node) in previous["nodes"].as_object().unwrap() {
        if node["type"] == "file" && remote.manifest["nodes"][id].is_null() {
            deletions.push(format!("files/{}", file_name(node)?));
            remote.files.remove(id);
        }
    }
    if previous != remote.manifest || !additions.is_empty() || !deletions.is_empty() {
        additions.insert(
            "manifest.json".into(),
            serde_json::to_vec_pretty(&remote.manifest).map_err(|error| error.to_string())?,
        );
    }
    Ok(Plan {
        snapshot: remote,
        additions,
        deletions,
    })
}

fn publish(store: &mut Store, captured: Captured, mut plan: Plan) -> Result<Changes, String> {
    store.transaction_active = true;
    store.outbox.retain(|op| {
        !captured.operations.iter().any(|old| {
            old["queueRevision"] == op["queueRevision"]
                && old["kind"] == op["kind"]
                && old["nodeId"] == op["nodeId"]
        })
    });
    replay(&mut plan.snapshot.manifest, &store.manifest, &store.outbox)?;
    for op in &mut store.outbox {
        let id = op["nodeId"].as_str().unwrap_or("");
        if op["kind"] == "push-note"
            && captured
                .operations
                .iter()
                .any(|old| old["kind"] == "push-note" && old["nodeId"] == id)
        {
            if let Some(bytes) = plan.snapshot.files.get(id) {
                op["baseFileRevision"] = if bytes.is_empty() {
                    Value::Null
                } else {
                    json!(super::store::revision(bytes))
                };
            }
        }
    }
    let remaining: HashSet<String> = store
        .outbox
        .iter()
        .filter(|op| op["kind"] == "push-note")
        .filter_map(|op| op["nodeId"].as_str().map(str::to_owned))
        .collect();
    let previous = store.manifest.clone();
    let mut changes = Changes::default();
    let mut writes = Vec::new();
    let mut merged_canvases = Vec::new();
    for (id, node) in plan.snapshot.manifest["nodes"].as_object().unwrap() {
        if node["type"] != "file" {
            continue;
        }
        if previous["nodes"][id]["type"] == "file"
            && store.sync.file_revisions.get(id) == plan.snapshot.sync.file_revisions.get(id)
            && !remaining.contains(id)
            && !captured
                .operations
                .iter()
                .any(|op| op["kind"] == "push-note" && op["nodeId"] == *id)
        {
            continue;
        }
        let current = if previous["nodes"][id]["type"] == "file" {
            store.read_file(&previous["nodes"][id])?
        } else {
            Vec::new()
        };
        let Some(downloaded) = plan.snapshot.files.get(id) else {
            continue;
        };
        let bytes = if node["fileType"] == "mcanvas" {
            let replaced = captured
                .operations
                .iter()
                .any(|op| op["nodeId"] == *id && op["replaceFile"] == true);
            let new_replacement = store
                .outbox
                .iter()
                .any(|op| op["nodeId"] == *id && op["replaceFile"] == true);
            if new_replacement {
                current.clone()
            } else if replaced && !remaining.contains(id) {
                downloaded.clone()
            } else {
                document::merge(downloaded, &current)?
            }
        } else if remaining.contains(id) {
            current.clone()
        } else {
            downloaded.clone()
        };
        if bytes != current {
            writes.push(FileWrite {
                name: file_name(node)?,
                bytes: Some(STANDARD.encode(&bytes)),
            });
            changes.changed.push(id.clone());
            if node["fileType"] == "mcanvas" {
                let generation = store
                    .sync
                    .document_generations
                    .entry(id.clone())
                    .or_insert_with(|| uuid::Uuid::new_v4().to_string())
                    .clone();
                changes.documents.push(super::DocumentNotification {
                    node_id: id.clone(),
                    bytes: bytes.clone(),
                    source_session: None,
                    origin: "repository".into(),
                    generation,
                    replacement: false,
                });
            }
        }
        if node["fileType"] == "mcanvas" {
            merged_canvases.push(id.clone());
            store
                .documents
                .insert(id.clone(), document::decode(&bytes)?);
        }
    }
    for id in merged_canvases {
        if !plan.snapshot.manifest["nodes"][&id]["system"].is_null() {
            continue;
        }
        if let Some(doc) = store.documents.get(&id) {
            let links = document::links(doc);
            if links.is_empty() {
                plan.snapshot.manifest["linksBySource"]
                    .as_object_mut()
                    .unwrap()
                    .remove(&id);
            } else {
                plan.snapshot.manifest["linksBySource"][&id] = json!(links);
            }
        }
    }
    for (id, node) in previous["nodes"].as_object().unwrap() {
        if plan.snapshot.manifest["nodes"][id].is_null() {
            changes.deleted.push(id.clone());
            if node["type"] == "file" {
                writes.push(FileWrite {
                    name: file_name(node)?,
                    bytes: None,
                });
                store.documents.remove(id);
            }
        } else if plan.snapshot.manifest["nodes"][id] != *node {
            changes.changed.push(id.clone());
        }
    }
    store.manifest = plan.snapshot.manifest;
    let generations = std::mem::take(&mut store.sync.document_generations);
    store.sync = plan.snapshot.sync;
    store.sync.document_generations = generations;
    store.sync.last_remote_sync_at = Some(now());
    store.commit(writes)?;
    Ok(changes)
}

impl RepositoryEngine {
    fn basis_dir(&self) -> std::path::PathBuf {
        self.cache_dir
            .join("repository-bases")
            .join(super::store::revision(self.id.as_bytes()))
    }

    pub(super) async fn clean_bases(&self) -> Result<(), String> {
        let active = self
            .with_store(|store| Ok(store.sync.basis_id.clone()))
            .await?;
        let root = self.basis_dir();
        tauri::async_runtime::spawn_blocking(move || {
            if !root.exists() {
                return Ok(());
            }
            for entry in std::fs::read_dir(root).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                let id = entry.file_name().to_string_lossy().to_string();
                if uuid::Uuid::parse_str(&id).is_ok() && Some(&id) != active.as_ref() {
                    crate::repository_bootstrap::reject_symlink(&entry.path())?;
                    std::fs::remove_dir_all(entry.path()).map_err(|error| error.to_string())?;
                }
            }
            Ok::<_, String>(())
        })
        .await
        .map_err(|error| error.to_string())?
    }

    pub(super) async fn synchronize(
        &self,
        app: &AppHandle,
        refresh_auth: bool,
    ) -> Result<(), String> {
        let _network = self.network_lock.lock().await;
        let Some(mut source) = self.source.lock().await.clone() else {
            return Ok(());
        };
        let result = async {
            if refresh_auth {
                let token = app
                    .state::<RepositoryManager>()
                    .token(app, self, false)
                    .await?;
                set_token(&mut source, token);
            }
            let mut outcome = self
                .cycle(source.clone(), &RemoteEndpoints::default())
                .await;
            if outcome.as_ref().is_err_and(|error| error.contains("(401)")) {
                let token = app
                    .state::<RepositoryManager>()
                    .token(app, self, true)
                    .await?;
                set_token(&mut source, token);
                outcome = self
                    .cycle(source.clone(), &RemoteEndpoints::default())
                    .await;
            }
            *self.source.lock().await = Some(source);
            outcome
        }
        .await;
        self.online.store(result.is_ok(), Ordering::Relaxed);
        *self.error.lock().unwrap() = result.as_ref().err().cloned();
        match result {
            Ok(changes) => {
                let _ = app.emit("repository-status", self.status().await);
                let _ = app.emit("repository-data", json!({"repositoryId": self.id, "changed": changes.changed, "deleted": changes.deleted}));
                for notification in changes.documents {
                    self.emit_document_change(&notification, |event, payload| {
                        let _ = app.emit(event, payload);
                    });
                    let app = app.clone();
                    let id = self.id.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::iroh_transport::broadcast_document(
                            &app,
                            &id,
                            &notification.node_id,
                            notification.bytes,
                        )
                        .await;
                    });
                }
                Ok(())
            }
            Err(error) => {
                let _ = app.emit("repository-status", self.status().await);
                Err(error)
            }
        }
    }

    pub(super) async fn cycle(
        &self,
        source: RepositorySource,
        endpoints: &RemoteEndpoints,
    ) -> Result<Changes, String> {
        let captured = self.with_store(capture).await?;
        let mut unchanged_head = false;
        if let RepositorySource::Github {
            owner,
            repo,
            branch,
            token,
        } = &source
        {
            let client = RemoteClient::new(token.clone(), true)?;
            let head = github_head(&client, endpoints, owner, repo, branch).await?;
            unchanged_head = captured.snapshot.sync.head_revision.as_deref() == Some(&head);
            if captured.operations.is_empty() && unchanged_head {
                return Ok(Changes::default());
            }
        }
        if let RepositorySource::GoogleDrive { folder_id, token } = &source {
            let client = RemoteClient::new(token.clone(), false)?;
            unchanged_head =
                drive_unchanged(&client, endpoints, folder_id, &captured.snapshot).await?;
            if captured.operations.is_empty() && unchanged_head {
                return Ok(Changes::default());
            }
        }
        let stage = self
            .cache_dir
            .join("repository-sync")
            .join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(stage.join("files"))
            .await
            .map_err(|error| error.to_string())?;
        let result = async {
            let basis = if unchanged_head {
                let cache = self.basis_dir();
                let sync = captured.snapshot.sync.clone();
                tauri::async_runtime::spawn_blocking(move || Snapshot::read_basis(&cache, &sync))
                    .await
                    .map_err(|error| error.to_string())??
            } else {
                None
            };
            let remote = match basis {
                Some(basis) => basis,
                None => {
                    download::download_repository(&stage, source.clone(), endpoints).await?;
                    let path = stage.clone();
                    tauri::async_runtime::spawn_blocking(move || Snapshot::read(&path))
                        .await
                        .map_err(|error| error.to_string())??
                }
            };
            let (captured, mut plan) = tauri::async_runtime::spawn_blocking(move || {
                let planned = plan(&captured, remote)?;
                Ok::<_, String>((captured, planned))
            })
            .await
            .map_err(|error| error.to_string())??;
            if !plan.additions.is_empty() || !plan.deletions.is_empty() {
                upload(&self.cache_dir, &source, endpoints, &mut plan).await?;
            }
            let cache = self.basis_dir();
            let mut plan = tauri::async_runtime::spawn_blocking(move || {
                plan.snapshot.save_basis(&cache)?;
                Ok::<_, String>(plan)
            })
            .await
            .map_err(|error| error.to_string())??;
            plan.snapshot.sync.last_remote_sync_at = Some(now());
            self.with_store(move |store| publish(store, captured, plan))
                .await
        }
        .await;
        let _ = tokio::fs::remove_dir_all(stage).await;
        let _ = self.clean_bases().await;
        result
    }
}

fn set_token(source: &mut RepositorySource, next: String) {
    match source {
        RepositorySource::Github { token, .. } | RepositorySource::GoogleDrive { token, .. } => {
            *token = next
        }
    }
}

async fn github_head(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    owner: &str,
    repo: &str,
    branch: &str,
) -> Result<String, String> {
    let payload = client
        .json(
            "GitHub branch request failed",
            Method::GET,
            endpoint(
                &endpoints.github,
                &["repos", owner, repo, "branches", branch],
            )?,
            None,
        )
        .await?;
    payload["commit"]["sha"]
        .as_str()
        .filter(|value| git2::Oid::from_str(value).is_ok())
        .map(str::to_owned)
        .ok_or("Invalid GitHub branch revision".into())
}

async fn observed_commit(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    owner: &str,
    repo: &str,
    branch: &str,
    commit: &str,
) -> Result<bool, String> {
    let head = github_head(client, endpoints, owner, repo, branch).await?;
    if head == commit {
        return Ok(true);
    }
    let compare = client
        .json(
            "GitHub push verification failed",
            Method::GET,
            endpoint(
                &endpoints.github,
                &[
                    "repos",
                    owner,
                    repo,
                    "compare",
                    &format!("{commit}...{head}"),
                ],
            )?,
            None,
        )
        .await?;
    Ok(compare["status"] == "ahead" || compare["status"] == "identical")
}

async fn upload(
    cache_dir: &Path,
    source: &RepositorySource,
    endpoints: &RemoteEndpoints,
    plan: &mut Plan,
) -> Result<(), String> {
    match source {
        RepositorySource::Github {
            owner,
            repo,
            branch,
            token,
        } => {
            for (path, bytes) in &plan.additions {
                if bytes.len() > 100_000_000 {
                    return Err(format!("File {path} exceeds the 100 MB GitHub sync limit"));
                }
            }
            let client = RemoteClient::new(token.clone(), true)?;
            let expected = plan
                .snapshot
                .sync
                .head_revision
                .clone()
                .ok_or("GitHub snapshot revision unavailable")?;
            let mut pushed = None;
            if endpoints.github == RemoteEndpoints::default().github {
                let stage_id = uuid::Uuid::new_v4().to_string();
                let stage = cache_dir.join("git-sync").join(&stage_id);
                tokio::fs::create_dir_all(&stage)
                    .await
                    .map_err(|error| error.to_string())?;
                let mut additions = Vec::new();
                for (index, (path, bytes)) in plan.additions.iter().enumerate() {
                    tokio::fs::write(stage.join(index.to_string()), bytes)
                        .await
                        .map_err(|error| error.to_string())?;
                    additions.push(GitPushFile {
                        path: path.clone(),
                        index,
                    });
                }
                let request = GitPushRequest {
                    owner: owner.clone(),
                    repo: repo.clone(),
                    branch: branch.clone(),
                    token: token.clone(),
                    expected_head_oid: expected.clone(),
                    message: "Sync notes".into(),
                    staging_id: stage_id,
                    additions,
                    deletions: plan.deletions.clone(),
                };
                let cache_dir = cache_dir.to_owned();
                let native = tauri::async_runtime::spawn_blocking(move || {
                    crate::github_push::push_batch(&cache_dir, request)
                })
                .await
                .map_err(|error| error.to_string())?;
                let _ = tokio::fs::remove_dir_all(stage).await;
                match native {
                    Ok(response) if response.status == "head-conflict" => {
                        return Err("GitHub branch changed during sync; retrying".into())
                    }
                    Ok(response) => {
                        if let Some(commit) = response.commit_oid {
                            if response.status == "pushed"
                                || observed_commit(&client, endpoints, owner, repo, branch, &commit)
                                    .await?
                            {
                                pushed = Some(commit);
                            }
                        }
                    }
                    Err(_) => {}
                }
            }
            let commit = match pushed {
                Some(commit) => commit,
                None => {
                    github_rest_push(
                        &client,
                        endpoints,
                        owner,
                        repo,
                        branch,
                        &expected,
                        &plan.additions,
                        &plan.deletions,
                    )
                    .await?
                }
            };
            plan.snapshot.sync.head_revision = Some(commit);
            for (id, bytes) in &plan.snapshot.files {
                plan.snapshot
                    .sync
                    .file_revisions
                    .insert(id.clone(), Some(blob_sha(bytes)?));
            }
        }
        RepositorySource::GoogleDrive { folder_id, token } => {
            let client = RemoteClient::new(token.clone(), false)?;
            drive_push(&client, endpoints, folder_id, plan).await?;
        }
    }
    Ok(())
}

async fn github_rest_push(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    owner: &str,
    repo: &str,
    branch: &str,
    expected: &str,
    additions: &HashMap<String, Vec<u8>>,
    deletions: &[String],
) -> Result<String, String> {
    let url = |parts: &[&str]| {
        let mut segments = vec!["repos", owner, repo];
        segments.extend(parts);
        endpoint(&endpoints.github, &segments)
    };
    if github_head(client, endpoints, owner, repo, branch).await? != expected {
        return Err("GitHub branch changed during sync; retrying".into());
    }
    let parent = client
        .json(
            "GitHub commit request failed",
            Method::GET,
            url(&["git", "commits", expected])?,
            None,
        )
        .await?;
    let mut tree = Vec::new();
    for (path, bytes) in additions {
        let blob = client
            .json(
                "GitHub blob upload failed",
                Method::POST,
                url(&["git", "blobs"])?,
                Some(json!({"content": STANDARD.encode(bytes), "encoding": "base64"})),
            )
            .await?;
        tree.push(json!({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]}));
    }
    for path in deletions {
        tree.push(json!({"path": path, "mode": "100644", "type": "blob", "sha": null}));
    }
    let tree = client
        .json(
            "GitHub tree upload failed",
            Method::POST,
            url(&["git", "trees"])?,
            Some(json!({"base_tree": parent["tree"]["sha"], "tree": tree})),
        )
        .await?;
    let commit = client
        .json(
            "GitHub commit upload failed",
            Method::POST,
            url(&["git", "commits"])?,
            Some(json!({"message": "Sync notes", "tree": tree["sha"], "parents": [expected]})),
        )
        .await?;
    let commit = commit["sha"]
        .as_str()
        .filter(|sha| git2::Oid::from_str(sha).is_ok())
        .ok_or("GitHub commit revision unavailable")?
        .to_owned();
    if github_head(client, endpoints, owner, repo, branch).await? != expected {
        return Err("GitHub branch changed during sync; retrying".into());
    }
    let mut segments = vec!["git", "refs", "heads"];
    segments.extend(branch.split('/'));
    let updated = client
        .json(
            "GitHub branch update failed",
            Method::PATCH,
            url(&segments)?,
            Some(json!({"sha": commit, "force": false})),
        )
        .await;
    if updated.is_err() && !observed_commit(client, endpoints, owner, repo, branch, &commit).await?
    {
        return Err(updated.unwrap_err());
    }
    Ok(commit)
}

async fn drive_push(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    folder: &str,
    plan: &mut Plan,
) -> Result<(), String> {
    let manifest = find_drive(client, endpoints, folder, "manifest.json", false).await?;
    if manifest
        .as_ref()
        .and_then(|entry| entry.head_revision_id.as_ref())
        != plan.snapshot.sync.head_revision.as_ref()
    {
        return Err("Google Drive manifest changed during sync; retrying".into());
    }
    let files_folder = match find_drive(client, endpoints, folder, "files", true).await? {
        Some(entry) => entry.id,
        None => client.json("Google Drive folder creation failed", Method::POST, endpoint(&endpoints.drive, &["files"])?, Some(json!({"name": "files", "mimeType": "application/vnd.google-apps.folder", "parents": [folder]}))).await?["id"].as_str().ok_or("Google Drive folder ID unavailable")?.to_owned(),
    };
    for (path, bytes) in &plan.additions {
        if path == "manifest.json" {
            continue;
        }
        let name = path
            .strip_prefix("files/")
            .ok_or("Invalid repository upload path")?;
        let existing = find_drive(client, endpoints, &files_folder, name, false).await?;
        let id = plan.snapshot.manifest["nodes"]
            .as_object()
            .unwrap()
            .iter()
            .find_map(|(id, node)| {
                (file_name(node).ok().as_deref() == Some(name)).then_some(id.clone())
            });
        if let Some(id) = &id {
            if existing
                .as_ref()
                .and_then(|entry| entry.head_revision_id.clone())
                != plan.snapshot.sync.file_revisions.get(id).cloned().flatten()
                || existing.as_ref().map(|entry| &entry.id) != plan.snapshot.sync.file_ids.get(id)
            {
                return Err("Google Drive file changed during sync; retrying".into());
            }
        }
        let entry = drive_write(client, endpoints, &files_folder, name, existing, bytes).await?;
        if let Some(id) = id {
            plan.snapshot.sync.file_ids.insert(id.clone(), entry.id);
            plan.snapshot
                .sync
                .file_revisions
                .insert(id, entry.head_revision_id);
        }
    }
    for path in &plan.deletions {
        if let Some(entry) = find_drive(
            client,
            endpoints,
            &files_folder,
            path.strip_prefix("files/")
                .ok_or("Invalid repository delete path")?,
            false,
        )
        .await?
        {
            require_success(
                client
                    .request(
                        "Google Drive delete failed",
                        Method::DELETE,
                        endpoint(&endpoints.drive, &["files", &entry.id])?,
                        None,
                    )
                    .await?,
                "Google Drive delete failed",
            )?;
        }
    }
    if find_drive(client, endpoints, folder, "manifest.json", false).await? != manifest {
        return Err("Google Drive manifest changed during sync; retrying".into());
    }
    if let Some(bytes) = plan.additions.get("manifest.json") {
        let entry =
            drive_write(client, endpoints, folder, "manifest.json", manifest, bytes).await?;
        plan.snapshot.sync.head_revision = entry.head_revision_id;
    }
    Ok(())
}

async fn drive_unchanged(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    folder: &str,
    snapshot: &Snapshot,
) -> Result<bool, String> {
    let Some(head) = &snapshot.sync.head_revision else {
        return Ok(false);
    };
    let manifest = find_drive(client, endpoints, folder, "manifest.json", false).await?;
    if manifest
        .as_ref()
        .and_then(|entry| entry.head_revision_id.as_ref())
        != Some(head)
    {
        return Ok(false);
    }
    let files_folder = find_drive(client, endpoints, folder, "files", true).await?;
    let Some(files_folder) = files_folder else {
        return Ok(snapshot.sync.file_revisions.is_empty());
    };
    let escaped = files_folder.id.replace('\\', "\\\\").replace('\'', "\\'");
    let query = format!("'{escaped}' in parents and trashed = false");
    let entries = download::list_drive(client, endpoints, &query, "1000").await?;
    for (id, node) in snapshot.manifest["nodes"].as_object().unwrap() {
        if node["type"] != "file" {
            continue;
        }
        let name = file_name(node)?;
        let Some(entry) = entries.iter().find(|entry| entry.name == name) else {
            return Ok(false);
        };
        if Some(&entry.id) != snapshot.sync.file_ids.get(id)
            || entry.head_revision_id.is_none()
            || entry.head_revision_id != snapshot.sync.file_revisions.get(id).cloned().flatten()
        {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn drive_write(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    parent: &str,
    name: &str,
    existing: Option<DriveEntry>,
    bytes: &[u8],
) -> Result<DriveEntry, String> {
    let id = match existing {
        Some(entry) => entry.id,
        None => client
            .json(
                "Google Drive file creation failed",
                Method::POST,
                endpoint(&endpoints.drive, &["files"])?,
                Some(json!({"name": name, "parents": [parent]})),
            )
            .await?["id"]
            .as_str()
            .ok_or("Google Drive file ID unavailable")?
            .to_owned(),
    };
    let mut url = endpoint(&endpoints.drive_upload, &["files", &id])?;
    url.query_pairs_mut()
        .append_pair("uploadType", "media")
        .append_pair("fields", "id,name,headRevisionId");
    let response = client
        .client
        .patch(url)
        .bearer_auth(&client.token)
        .header("Content-Type", "application/octet-stream")
        .body(bytes.to_vec())
        .send()
        .await
        .map_err(|_| "Google Drive upload failed before receiving a response")?;
    let response = require_success(response, "Google Drive upload failed")?
        .bytes()
        .await
        .map_err(|_| "Google Drive upload response unreadable")?;
    serde_json::from_slice(&response).map_err(|_| "Google Drive upload revision unreadable".into())
}
