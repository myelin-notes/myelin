use super::{
    document,
    store::{file_name, now, FileWrite, Store, SyncState},
    Changes, RepositoryEngine, RepositoryManager,
};
use crate::repository_metadata as metadata;
use crate::{
    github_push::{GitPushFile, GitPushRequest},
    repository_bootstrap::download::{
        self, endpoint, find_drive, require_success, CachedFile, DriveEntry, RemoteClient,
        RemoteEndpoints, RepositorySource,
    },
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_http::reqwest::Method;

#[derive(Clone)]
struct Snapshot {
    manifest: Value,
    records: HashMap<String, Vec<u8>>,
    legacy: Option<Vec<u8>>,
    corrupt: Vec<String>,
    marker: bool,
    files: HashMap<String, SnapshotFile>,
    sync: SyncState,
}

#[derive(Clone)]
enum SnapshotFile {
    Cached(PathBuf),
    Loaded(Vec<u8>),
}

impl SnapshotFile {
    fn read(&self) -> Result<Cow<'_, [u8]>, String> {
        match self {
            Self::Cached(path) => std::fs::read(path)
                .map(Cow::Owned)
                .map_err(|error| error.to_string()),
            Self::Loaded(bytes) => Ok(Cow::Borrowed(bytes)),
        }
    }
}

#[derive(Deserialize, Serialize)]
struct DriveUpload {
    marker: String,
    revision: Option<String>,
    content_revision: String,
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
        let loaded = metadata::load(root)?;
        let manifest = loaded.manifest;
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
        let github_revisions: HashMap<String, String> =
            match std::fs::read(root.join(".remote-file-revisions.json")) {
                Ok(bytes) => serde_json::from_slice(&bytes)
                    .map_err(|_| "Unreadable GitHub file revisions")?,
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
            let file = SnapshotFile::Cached(root.join("files").join(&name));
            let revision = if head.is_some() {
                Some(match github_revisions.get(&name) {
                    Some(revision) => revision.clone(),
                    None => blob_sha(&file.read()?)?,
                })
            } else {
                drive
                    .get(&name)
                    .and_then(|entry| entry.head_revision_id.clone())
            };
            if let Some(entry) = drive.get(&name) {
                file_ids.insert(id.clone(), entry.id.clone());
            }
            files.insert(id.clone(), file);
            revisions.insert(id.clone(), revision);
        }
        let sidecars = loaded.legacy.is_none();
        let drive_head = drive
            .get(if sidecars {
                metadata::SETTINGS
            } else {
                "manifest.json"
            })
            .and_then(|entry| entry.head_revision_id.clone());
        Ok(Self {
            manifest,
            records: loaded.records,
            legacy: loaded.legacy,
            corrupt: loaded.corrupt,
            marker: std::fs::read(root.join("manifest.json"))
                .is_ok_and(|bytes| metadata::is_marker(&bytes)),
            files,
            sync: SyncState {
                last_remote_sync_at: None,
                head_revision: head.or(drive_head),
                file_revisions: revisions,
                basis_id: None,
                file_ids,
                document_generations: HashMap::new(),
                sidecars,
                metadata_entries: drive
                    .into_iter()
                    .filter_map(|(name, entry)| {
                        if name == metadata::SETTINGS || name == "manifest.json" {
                            Some((name, entry))
                        } else if name.ends_with(metadata::SUFFIX) {
                            Some((format!("files/{name}"), entry))
                        } else {
                            None
                        }
                    })
                    .collect(),
            },
        })
    }

    fn cached_files(&self, cache: &Path) -> Result<HashMap<String, CachedFile>, String> {
        let Some(basis_id) = &self.sync.basis_id else {
            return Ok(HashMap::new());
        };
        let root = cache.join(basis_id);
        let mut files = HashMap::new();
        for (id, node) in self.manifest["nodes"].as_object().unwrap() {
            if node["type"] != "file" {
                continue;
            }
            if let Some(revision) = self
                .sync
                .file_revisions
                .get(id)
                .and_then(Option::as_ref)
                .filter(|revision| !revision.is_empty())
            {
                let name = file_name(node)?;
                files.insert(
                    name.clone(),
                    CachedFile {
                        path: root.join("files").join(name),
                        revision: revision.clone(),
                        drive_id: self.sync.file_ids.get(id).cloned(),
                    },
                );
            }
        }
        for (path, bytes) in &self.records {
            let entry = self.sync.metadata_entries.get(path);
            let revision = if self
                .sync
                .head_revision
                .as_ref()
                .is_some_and(|head| git2::Oid::from_str(head).is_ok())
            {
                Some(blob_sha(bytes)?)
            } else {
                entry.and_then(|entry| entry.head_revision_id.clone())
            };
            if let Some(revision) = revision {
                files.insert(
                    path.clone(),
                    CachedFile {
                        path: root.join(path),
                        revision,
                        drive_id: entry.map(|entry| entry.id.clone()),
                    },
                );
            }
        }
        if self.sync.sidecars {
            files.insert(
                "manifest.json".into(),
                CachedFile {
                    path: root.join("manifest.json"),
                    revision: blob_sha(metadata::MARKER)?,
                    drive_id: None,
                },
            );
        }
        Ok(files)
    }

    fn save_basis(
        &mut self,
        cache: &Path,
        cached: &HashMap<String, CachedFile>,
    ) -> Result<(), String> {
        let id = uuid::Uuid::new_v4().to_string();
        let root = cache.join(&id);
        std::fs::create_dir_all(root.join("files")).map_err(|error| error.to_string())?;
        for (id, bytes) in &self.files {
            if self.manifest["nodes"][id]["type"] != "file" {
                continue;
            }
            let name = file_name(&self.manifest["nodes"][id])?;
            let destination = root.join("files").join(&name);
            let linked = self
                .sync
                .file_revisions
                .get(id)
                .and_then(Option::as_deref)
                .is_some_and(|revision| {
                    cached.get(&name).is_some_and(|file| {
                        file.link(
                            &destination,
                            revision,
                            self.sync.file_ids.get(id).map(String::as_str),
                        )
                    })
                });
            if !linked {
                let linked = match bytes {
                    SnapshotFile::Cached(path) => std::fs::hard_link(path, &destination).is_ok(),
                    SnapshotFile::Loaded(_) => false,
                };
                if !linked {
                    super::store::atomic_write(&destination, &bytes.read()?)?;
                }
            }
        }
        crate::repository_bootstrap::sync_directory(&root.join("files"))?;
        for (path, bytes) in &self.records {
            let entry = self.sync.metadata_entries.get(path);
            let revision = match entry {
                Some(entry) => entry.head_revision_id.clone(),
                None => Some(blob_sha(bytes)?),
            };
            let destination = root.join(path);
            let linked = revision.as_deref().is_some_and(|revision| {
                cached.get(path).is_some_and(|file| {
                    file.link(&destination, revision, entry.map(|entry| entry.id.as_str()))
                })
            });
            if !linked {
                super::store::atomic_write(&destination, bytes)?;
            }
        }
        super::store::atomic_write(&root.join("manifest.json"), metadata::MARKER)?;
        self.sync.basis_id = Some(id);
        super::store::atomic_write(
            &root.join("sync.json"),
            &serde_json::to_vec(&self.sync).map_err(|error| error.to_string())?,
        )?;
        crate::repository_bootstrap::sync_directory(cache)
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
        let loaded = metadata::load(&root)?;
        if !loaded.corrupt.is_empty() {
            return Ok(None);
        }
        let manifest = loaded.manifest;
        let saved = match std::fs::read(root.join("sync.json")) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let saved: SyncState =
            serde_json::from_slice(&saved).map_err(|_| "Invalid native remote basis")?;
        if saved.basis_id.as_ref() != Some(id) {
            return Err("Invalid native remote basis".into());
        }
        if saved.head_revision != sync.head_revision {
            return Ok(None);
        }
        let mut files = HashMap::new();
        for (id, node) in manifest["nodes"].as_object().unwrap() {
            if node["type"] == "file" {
                let path = root.join("files").join(file_name(node)?);
                match std::fs::metadata(&path) {
                    Ok(_) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                    Err(error) => return Err(error.to_string()),
                };
                files.insert(id.clone(), SnapshotFile::Cached(path));
            }
        }
        Ok(Some(Self {
            manifest,
            records: loaded.records,
            legacy: loaded.legacy,
            corrupt: loaded.corrupt,
            marker: true,
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
            files.insert(id.into(), SnapshotFile::Loaded(store.read_file(node)?));
        }
    }
    Ok(Captured {
        snapshot: Snapshot {
            manifest: store.manifest.clone(),
            records: store.metadata_records(),
            legacy: None,
            corrupt: Vec::new(),
            marker: true,
            files,
            sync: store.sync.clone(),
        },
        operations: store.outbox.clone(),
    })
}

fn replay(manifest: &mut Value, local: &Value, operations: &[Value]) -> Result<(), String> {
    if !manifest["deletedNodes"].is_object() {
        manifest["deletedNodes"] = json!({});
    }
    for op in operations {
        let id = op["nodeId"].as_str().unwrap_or("");
        match op["kind"].as_str() {
            Some("upsert-manifest-node" | "push-note") => {
                if local["nodes"][id].is_null()
                    || (!manifest["deletedNodes"][id].is_null()
                        && local["restoredNodes"][id] != manifest["deletedNodes"][id])
                {
                    continue;
                }
                manifest["deletedNodes"].as_object_mut().unwrap().remove(id);
                if !local["restoredNodes"][id].is_null() {
                    if !manifest["restoredNodes"].is_object() {
                        manifest["restoredNodes"] = json!({});
                    }
                    manifest["restoredNodes"][id] = local["restoredNodes"][id].clone();
                }
                let mut pending = vec![id.to_owned()];
                let mut visited = HashSet::new();
                while let Some(id) = pending.pop() {
                    if !visited.insert(id.clone()) {
                        return Err("Repository folder ancestry contains a cycle".into());
                    }
                    let node = &local["nodes"][&id];
                    if node.is_null() || !manifest["deletedNodes"][&id].is_null() {
                        continue;
                    }
                    if let Some(parent) = node["parentId"].as_str() {
                        if manifest["nodes"][parent].is_null() {
                            pending.push(parent.into());
                        }
                    }
                    manifest["nodes"][&id] = node.clone();
                    if let Some(parent) = node["parentId"].as_str() {
                        if manifest["nodes"][parent].is_null()
                            && (local["nodes"][parent].is_null()
                                || !manifest["deletedNodes"][parent].is_null())
                        {
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
                    manifest["deletedNodes"][&id] = op["queueRevision"].clone();
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
    let previous_records = std::mem::take(&mut remote.records);
    replay(
        &mut remote.manifest,
        &captured.snapshot.manifest,
        &captured.operations,
    )?;
    if remote.legacy.is_some() {
        for path in remote.sync.metadata_entries.keys() {
            if let Some(id) = path
                .strip_prefix("files/")
                .and_then(|name| name.strip_suffix(metadata::SUFFIX))
            {
                if remote.manifest["nodes"][id].is_null()
                    && remote.manifest["deletedNodes"][id].is_null()
                {
                    remote.manifest["deletedNodes"][id] = json!(uuid::Uuid::new_v4().to_string());
                }
            }
        }
    }
    let mut additions = HashMap::new();
    for op in &captured.operations {
        if op["kind"] != "push-note" {
            continue;
        }
        let source_id = op["nodeId"].as_str().ok_or("Invalid cached note ID")?;
        let mut id = source_id.to_owned();
        let mut node = captured.snapshot.manifest["nodes"][source_id].clone();
        if node["type"] != "file" {
            continue;
        }
        let recovered = remote.manifest["nodes"][&id].is_null()
            && !remote.manifest["deletedNodes"][&id].is_null();
        if recovered {
            id = format!(
                "conflict-{}",
                op["queueRevision"]
                    .as_str()
                    .ok_or("Missing queued revision")?
            );
            node["id"] = json!(id);
            node["name"] = json!(format!(
                "{} (Recovered deleted file)",
                node["name"].as_str().unwrap_or("File")
            ));
            if node["parentId"]
                .as_str()
                .is_some_and(|parent| remote.manifest["nodes"][parent].is_null())
            {
                node["parentId"] = Value::Null;
            }
            remote.manifest["nodes"][&id] = node.clone();
        } else if remote.manifest["nodes"][&id].is_null() {
            continue;
        }
        let local = captured
            .snapshot
            .files
            .get(source_id)
            .ok_or("Queued repository file is missing")?
            .read()?;
        let old = remote
            .files
            .get(&id)
            .map(SnapshotFile::read)
            .transpose()?
            .unwrap_or_default();
        let replacement = recovered || op["replaceFile"] == true;
        let bytes = if node["fileType"] == "mcanvas" {
            if replacement {
                local.to_vec()
            } else {
                document::merge(&old, &local)?
            }
        } else {
            let base = op.get("baseFileRevision").cloned().unwrap_or(Value::Null);
            let current = if old.is_empty() {
                Value::Null
            } else {
                json!(super::store::revision(&old))
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
                if previous["nodes"][&id]["type"] == "file" {
                    remote.manifest["nodes"][&id] = previous["nodes"][&id].clone();
                } else {
                    remote.manifest["nodes"]
                        .as_object_mut()
                        .unwrap()
                        .remove(&id);
                }
                remote.manifest["nodes"][&conflict_id] = conflict.clone();
                additions.insert(format!("files/{}", file_name(&conflict)?), local.to_vec());
                remote
                    .files
                    .insert(conflict_id, SnapshotFile::Loaded(local.to_vec()));
                continue;
            }
            local.to_vec()
        };
        if old != bytes {
            additions.insert(format!("files/{}", file_name(&node)?), bytes.clone());
        }
        remote
            .files
            .insert(id.clone(), SnapshotFile::Loaded(bytes.clone()));
        if node["fileType"] == "mcanvas" && node["system"].is_null() {
            let links = document::links(&document::decode(&bytes)?);
            if links.is_empty() {
                remote.manifest["linksBySource"]
                    .as_object_mut()
                    .unwrap()
                    .remove(&id);
            } else {
                remote.manifest["linksBySource"][&id] = json!(links);
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
    let mut records = if remote.legacy.is_some() {
        metadata::records(&remote.manifest)?
    } else {
        let mut records = previous_records.clone();
        for id in metadata::changed_nodes(&previous, &remote.manifest) {
            records.insert(
                format!("files/{id}{}", metadata::SUFFIX),
                metadata::node_record(&remote.manifest, &id)?,
            );
        }
        records.insert(
            metadata::SETTINGS.into(),
            metadata::settings(&remote.manifest)?,
        );
        records
    };
    for (path, bytes) in &records {
        if previous_records.get(path) != Some(bytes) {
            additions.insert(path.clone(), bytes.clone());
        }
    }
    if let Some(legacy) = remote.legacy.take() {
        additions.insert(metadata::BACKUP.into(), legacy);
        additions.insert("manifest.json".into(), metadata::MARKER.to_vec());
    }
    if !remote.marker {
        additions.insert("manifest.json".into(), metadata::MARKER.to_vec());
    }
    remote.marker = true;
    if !additions.is_empty() || !deletions.is_empty() {
        remote.manifest["generation"] = json!(uuid::Uuid::new_v4().to_string());
        records.insert(
            metadata::SETTINGS.into(),
            metadata::settings(&remote.manifest)?,
        );
        additions.insert(
            metadata::SETTINGS.into(),
            records[metadata::SETTINGS].clone(),
        );
    }
    remote.records = records;
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
    let mut recovered_updates = Vec::new();
    for op in store.outbox.clone() {
        let Some(id) = op["nodeId"].as_str() else {
            continue;
        };
        if op["kind"] != "push-note"
            || plan.snapshot.manifest["deletedNodes"][id].is_null()
            || store.manifest["nodes"][id]["type"] != "file"
        {
            continue;
        }
        let captured_op = captured
            .operations
            .iter()
            .find(|old| old["kind"] == "push-note" && old["nodeId"] == id)
            .unwrap_or(&op);
        let recovery_id = format!(
            "conflict-{}",
            captured_op["queueRevision"]
                .as_str()
                .ok_or("Missing queued revision")?
        );
        let mut node = store.manifest["nodes"][id].clone();
        let local = store.read_file(&node)?;
        let base = plan
            .snapshot
            .files
            .get(&recovery_id)
            .map(SnapshotFile::read)
            .transpose()?;
        let base_revision = base
            .as_ref()
            .map(|bytes| json!(super::store::revision(bytes)))
            .unwrap_or(Value::Null);
        let bytes = if node["fileType"] == "mcanvas" {
            document::merge(base.as_deref().unwrap_or_default(), &local)?
        } else {
            local
        };
        node["id"] = json!(recovery_id);
        node["name"] = json!(format!(
            "{} (Recovered deleted file)",
            node["name"].as_str().unwrap_or("File")
        ));
        if node["parentId"]
            .as_str()
            .is_some_and(|parent| plan.snapshot.manifest["nodes"][parent].is_null())
        {
            node["parentId"] = Value::Null;
        }
        plan.snapshot.manifest["nodes"][&recovery_id] = node;
        plan.snapshot
            .files
            .insert(recovery_id.clone(), SnapshotFile::Loaded(bytes));
        store.outbox.retain(|pending| pending["nodeId"] != id);
        recovered_updates.push((recovery_id, base_revision));
    }
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
                let bytes = bytes.read()?;
                op["baseFileRevision"] = if bytes.is_empty() {
                    Value::Null
                } else {
                    json!(super::store::revision(&bytes))
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
    let mut canvas_links = Vec::new();
    for (id, node) in plan.snapshot.manifest["nodes"].as_object().unwrap() {
        if node["type"] != "file" {
            continue;
        }
        if previous["nodes"][id]["type"] == "file"
            && store.sync.file_revisions.get(id) == plan.snapshot.sync.file_revisions.get(id)
            && store.sync.file_ids.get(id) == plan.snapshot.sync.file_ids.get(id)
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
        let downloaded = downloaded.read()?;
        let mut canvas_doc = None;
        let mut canvas_update = Vec::new();
        let bytes = if node["fileType"] == "mcanvas" {
            let replaced = captured
                .operations
                .iter()
                .any(|op| op["nodeId"] == *id && op["replaceFile"] == true);
            let new_replacement = store
                .outbox
                .iter()
                .any(|op| op["nodeId"] == *id && op["replaceFile"] == true);
            let doc = document::decode(&current)?;
            let before = document::vector(&doc);
            let doc = if new_replacement {
                doc
            } else if replaced && !remaining.contains(id) {
                document::decode(&downloaded)?
            } else {
                document::apply(&doc, &downloaded)?;
                doc
            };
            canvas_update = document::diff(&doc, Some(&before))?.0;
            let bytes = document::bytes(&doc);
            canvas_doc = Some(doc);
            bytes
        } else if remaining.contains(id) {
            current.clone()
        } else {
            downloaded.to_vec()
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
                    bytes: canvas_update,
                    source_session: None,
                    origin: "repository".into(),
                    generation,
                    replacement: false,
                });
            }
        }
        if let Some(doc) = canvas_doc {
            if node["system"].is_null() {
                canvas_links.push((id.clone(), document::links(&doc)));
            }
            if store.documents.contains_key(id) {
                store.documents.insert(id.clone(), doc);
            }
        }
    }
    for (id, links) in canvas_links {
        if links.is_empty() {
            plan.snapshot.manifest["linksBySource"]
                .as_object_mut()
                .unwrap()
                .remove(&id);
        } else {
            plan.snapshot.manifest["linksBySource"][&id] = json!(links);
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
    store.replace_metadata(plan.snapshot.manifest);
    for (id, base_revision) in recovered_updates {
        store.queue(
            "push-note",
            Some(&id),
            json!({"baseFileRevision":base_revision}),
        );
        store.queue("upsert-manifest-node", Some(&id), json!({}));
    }
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
        let mut pending_drive_deletions = false;
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
            if captured.operations.is_empty() && unchanged_head && captured.snapshot.sync.sidecars {
                return Ok(Changes::default());
            }
        }
        if let RepositorySource::GoogleDrive { folder_id, token } = &source {
            let client = RemoteClient::new(token.clone(), false)?;
            unchanged_head =
                drive_unchanged(&client, endpoints, folder_id, &captured.snapshot).await?;
            pending_drive_deletions = drive_deletions_path(&self.cache_dir, folder_id).exists();
            if captured.operations.is_empty()
                && unchanged_head
                && !pending_drive_deletions
                && captured.snapshot.sync.sidecars
            {
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
            let cache = self.basis_dir();
            let sync = captured.snapshot.sync.clone();
            let basis =
                tauri::async_runtime::spawn_blocking(move || Snapshot::read_basis(&cache, &sync))
                    .await
                    .map_err(|error| error.to_string())??;
            let cached = basis
                .as_ref()
                .map(|basis| basis.cached_files(&self.basis_dir()))
                .transpose()?
                .unwrap_or_default();
            let mut remote = match basis {
                Some(basis) if unchanged_head && basis.sync.sidecars => basis,
                _ => {
                    download::download_repository_cached(
                        &stage,
                        source.clone(),
                        endpoints,
                        &cached,
                    )
                    .await?;
                    let path = stage.clone();
                    tauri::async_runtime::spawn_blocking(move || Snapshot::read(&path))
                        .await
                        .map_err(|error| error.to_string())??
                }
            };
            if remote.sync.sidecars && captured.snapshot.sync.sidecars {
                for id in captured.snapshot.manifest["nodes"].as_object().unwrap().keys() {
                    let path = format!("files/{id}{}", metadata::SUFFIX);
                    let published = captured.snapshot.sync.file_revisions.contains_key(id) || captured.snapshot.sync.metadata_entries.contains_key(&path) || cached.contains_key(&path);
                    if published && remote.manifest["nodes"][id].is_null() && remote.manifest["deletedNodes"][id].is_null() {
                        remote.corrupt.push(path);
                    }
                }
            }
            if !remote.corrupt.is_empty() {
                return self.with_store(move |store| {
                    let local = metadata::records(&store.manifest)?;
                    let mut readable = remote.records.clone();
                    for id in store.manifest["nodes"].as_object().unwrap().keys() {
                        if remote.manifest["nodes"][id].is_null() && remote.manifest["deletedNodes"][id].is_null() {
                            let path = format!("files/{id}{}", metadata::SUFFIX);
                            readable.insert(path.clone(), local[&path].clone());
                        }
                    }
                    if remote.corrupt.iter().any(|path|path == metadata::SETTINGS) { readable.insert(metadata::SETTINGS.into(), local[metadata::SETTINGS].clone()); }
                    remote.manifest = metadata::assemble(&readable)?;
                    remote.sync.sidecars = false;
                    let error = format!("Remote repository metadata requires recovery; remote sync is paused: {}", remote.corrupt.join(", "));
                    let changes = publish(store, Captured { snapshot: captured.snapshot, operations: Vec::new() }, Plan { snapshot:remote,additions:HashMap::new(),deletions:Vec::new() })?;
                    super::store::atomic_write(&store.root.join(".native-recovery-error"), error.as_bytes())?;
                    store.recovery_error = Some(error);
                    Ok(changes)
                }).await;
            }
            let (captured, mut plan) = tauri::async_runtime::spawn_blocking(move || {
                let planned = plan(&captured, remote)?;
                Ok::<_, String>((captured, planned))
            })
            .await
            .map_err(|error| error.to_string())??;
            if !plan.additions.is_empty() || !plan.deletions.is_empty() || pending_drive_deletions {
                upload(&self.cache_dir, &source, endpoints, &mut plan).await?;
            }
            let cache = self.basis_dir();
            let mut plan = tauri::async_runtime::spawn_blocking(move || {
                plan.snapshot.save_basis(&cache, &cached)?;
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
            plan.snapshot.sync.sidecars = true;
            for (id, node) in plan.snapshot.manifest["nodes"].as_object().unwrap() {
                if node["type"] != "file" {
                    continue;
                }
                if let Some(bytes) = plan.additions.get(&format!("files/{}", file_name(node)?)) {
                    plan.snapshot
                        .sync
                        .file_revisions
                        .insert(id.clone(), Some(blob_sha(bytes)?));
                }
            }
        }
        RepositorySource::GoogleDrive { folder_id, token } => {
            let client = RemoteClient::new(token.clone(), false)?;
            drive_push(cache_dir, &client, endpoints, folder_id, plan).await?;
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

fn drive_deletions_path(cache_dir: &Path, folder: &str) -> std::path::PathBuf {
    cache_dir.join(format!(
        ".drive-deletions-{}.json",
        super::store::revision(folder.as_bytes())
    ))
}

async fn drive_push(
    cache_dir: &Path,
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    folder: &str,
    plan: &mut Plan,
) -> Result<(), String> {
    let journal = cache_dir.join(format!(
        ".drive-uploads-{}.json",
        super::store::revision(folder.as_bytes())
    ));
    let mut uploads: HashMap<String, DriveUpload> = match std::fs::read(&journal) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "Unreadable Google Drive upload journal")?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
        Err(error) => return Err(error.to_string()),
    };
    let deletion_journal = drive_deletions_path(cache_dir, folder);
    let mut deletions: HashMap<String, DriveEntry> = match std::fs::read(&deletion_journal) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "Unreadable Google Drive deletion journal")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
        Err(error) => return Err(error.to_string()),
    };
    let save_uploads = |uploads: &HashMap<String, DriveUpload>| {
        super::store::atomic_write(
            &journal,
            &serde_json::to_vec(uploads).map_err(|error| error.to_string())?,
        )
    };
    let head_name = if plan.snapshot.sync.sidecars {
        metadata::SETTINGS
    } else {
        "manifest.json"
    };
    let head = find_drive(client, endpoints, folder, head_name, false).await?;
    if head
        .as_ref()
        .and_then(|entry| entry.head_revision_id.as_ref())
        != plan.snapshot.sync.head_revision.as_ref()
    {
        return Err("Google Drive metadata changed during sync; retrying".into());
    }
    let files_folder = match find_drive(client, endpoints, folder, "files", true).await? {
        Some(entry) => entry.id,
        None => client.json("Google Drive folder creation failed", Method::POST, endpoint(&endpoints.drive, &["files"])?, Some(json!({"name": "files", "mimeType": "application/vnd.google-apps.folder", "parents": [folder]}))).await?["id"].as_str().ok_or("Google Drive folder ID unavailable")?.to_owned(),
    };
    for (path, bytes) in &plan.additions {
        if !path.starts_with("files/") || metadata::is_metadata_path(path) {
            continue;
        }
        let name = path
            .strip_prefix("files/")
            .ok_or("Invalid repository upload path")?;
        let mut existing = find_drive(client, endpoints, &files_folder, name, false).await?;
        let id = plan.snapshot.manifest["nodes"]
            .as_object()
            .unwrap()
            .iter()
            .find_map(|(id, node)| {
                (file_name(node).ok().as_deref() == Some(name)).then_some(id.clone())
            });
        let unpublished = id
            .as_ref()
            .is_some_and(|id| !plan.snapshot.sync.file_ids.contains_key(id));
        let restored = existing
            .as_ref()
            .is_some_and(|entry| deletions.get(name) == Some(entry));
        if restored {
            let upload = uploads.entry(name.into()).or_insert_with(|| DriveUpload {
                marker: uuid::Uuid::new_v4().to_string(),
                revision: None,
                content_revision: String::new(),
            });
            upload.revision = existing
                .as_ref()
                .and_then(|entry| entry.head_revision_id.clone());
            upload.content_revision = super::store::revision(bytes);
            save_uploads(&uploads)?;
        }
        let mut reuse = false;
        if unpublished && !restored {
            if let Some(entry) = &existing {
                let owned = uploads.get(name).filter(|upload| {
                    entry.app_properties.get("myelinUpload") == Some(&upload.marker)
                        || deletions
                            .get(name)
                            .is_some_and(|previous| previous.id == entry.id)
                });
                if !owned.is_some_and(|upload| {
                    upload.revision.is_some() && upload.revision == entry.head_revision_id
                }) {
                    let mut url = endpoint(&endpoints.drive, &["files", &entry.id])?;
                    if let Some(revision) = &entry.head_revision_id {
                        url = endpoint(
                            &endpoints.drive,
                            &["files", &entry.id, "revisions", revision],
                        )?;
                    }
                    url.query_pairs_mut().append_pair("alt", "media");
                    let remote_bytes = require_success(
                        client
                            .request("Google Drive download failed", Method::GET, url, None)
                            .await?,
                        "Google Drive download failed",
                    )?
                    .bytes()
                    .await
                    .map_err(|_| "Google Drive download unreadable")?;
                    reuse = remote_bytes.as_ref() == bytes;
                    if !reuse
                        && !owned.is_some_and(|upload| {
                            super::store::revision(&remote_bytes) == upload.content_revision
                                || (upload.revision.is_none() && remote_bytes.is_empty())
                        })
                    {
                        return Err("Google Drive file changed during sync; retrying".into());
                    }
                    if find_drive(client, endpoints, &files_folder, name, false).await? != existing
                    {
                        return Err("Google Drive file changed during sync; retrying".into());
                    }
                }
            } else {
                let upload = uploads.entry(name.into()).or_insert_with(|| DriveUpload {
                    marker: uuid::Uuid::new_v4().to_string(),
                    revision: None,
                    content_revision: super::store::revision(bytes),
                });
                upload.revision = None;
                upload.content_revision = super::store::revision(bytes);
                let marker = upload.marker.clone();
                save_uploads(&uploads)?;
                let mut url = endpoint(&endpoints.drive, &["files"])?;
                url.query_pairs_mut()
                    .append_pair("fields", "id,name,headRevisionId,appProperties");
                let created = client.json("Google Drive file creation failed", Method::POST, url,
                    Some(json!({"name": name, "parents": [&files_folder], "appProperties": {"myelinUpload": marker}}))).await?;
                existing = Some(
                    serde_json::from_value(created)
                        .map_err(|_| "Google Drive file revision unreadable")?,
                );
            }
            if !reuse {
                if let Some(upload) = uploads.get_mut(name) {
                    upload.revision = existing
                        .as_ref()
                        .and_then(|entry| entry.head_revision_id.clone());
                    upload.content_revision = super::store::revision(bytes);
                    save_uploads(&uploads)?;
                }
            }
        } else if let Some(id) = id.as_ref().filter(|_| !restored) {
            if existing
                .as_ref()
                .and_then(|entry| entry.head_revision_id.clone())
                != plan.snapshot.sync.file_revisions.get(id).cloned().flatten()
                || existing.as_ref().map(|entry| &entry.id) != plan.snapshot.sync.file_ids.get(id)
            {
                return Err("Google Drive file changed during sync; retrying".into());
            }
        }
        let entry = if reuse {
            existing.unwrap()
        } else {
            drive_write(client, endpoints, &files_folder, name, existing, bytes).await?
        };
        if let Some(upload) = uploads.get_mut(name) {
            upload.revision = entry.head_revision_id.clone();
            save_uploads(&uploads)?;
        }
        if restored {
            deletions.insert(name.into(), entry.clone());
            super::store::atomic_write(
                &deletion_journal,
                &serde_json::to_vec(&deletions).map_err(|error| error.to_string())?,
            )?;
        }
        if let Some(id) = id {
            plan.snapshot.sync.file_ids.insert(id.clone(), entry.id);
            plan.snapshot
                .sync
                .file_revisions
                .insert(id, entry.head_revision_id);
        }
    }
    for path in &plan.deletions {
        let name = path
            .strip_prefix("files/")
            .ok_or("Invalid repository delete path")?;
        if let Some(entry) = find_drive(client, endpoints, &files_folder, name, false).await? {
            if plan.snapshot.sync.file_ids.iter().any(|(id, file_id)| {
                file_id == &entry.id
                    && plan.snapshot.sync.file_revisions.get(id) == Some(&entry.head_revision_id)
            }) {
                deletions.entry(name.into()).or_insert(entry);
            }
        }
    }
    if !deletions.is_empty() {
        super::store::atomic_write(
            &deletion_journal,
            &serde_json::to_vec(&deletions).map_err(|error| error.to_string())?,
        )?;
    }
    if find_drive(client, endpoints, folder, head_name, false).await? != head {
        return Err("Google Drive metadata changed during sync; retrying".into());
    }
    if let Some(bytes) = plan.additions.get(metadata::BACKUP) {
        if find_drive(client, endpoints, folder, metadata::BACKUP, false)
            .await?
            .is_none()
        {
            drive_metadata_write(client, endpoints, folder, metadata::BACKUP, None, bytes).await?;
        }
    }
    let mut metadata_paths: Vec<_> = plan
        .additions
        .keys()
        .filter(|path| metadata::is_metadata_path(path))
        .collect();
    metadata_paths.sort();
    for path in metadata_paths {
        let name = path.strip_prefix("files/").unwrap();
        let existing = find_drive(client, endpoints, &files_folder, name, false).await?;
        let bytes = &plan.additions[path];
        if plan.snapshot.sync.sidecars
            && existing.as_ref() != plan.snapshot.sync.metadata_entries.get(path)
        {
            if !drive_bytes_match(client, endpoints, existing.as_ref(), bytes).await? {
                return Err("Google Drive node metadata changed during sync; retrying".into());
            }
            plan.snapshot
                .sync
                .metadata_entries
                .insert(path.clone(), existing.unwrap());
        } else {
            let entry =
                drive_metadata_write(client, endpoints, &files_folder, name, existing, bytes)
                    .await?;
            plan.snapshot
                .sync
                .metadata_entries
                .insert(path.clone(), entry);
        }
    }
    if find_drive(client, endpoints, folder, head_name, false).await? != head {
        return Err("Google Drive metadata changed during sync; retrying".into());
    }
    let published_head = if let Some(bytes) = plan.additions.get(metadata::SETTINGS) {
        let existing = find_drive(client, endpoints, folder, metadata::SETTINGS, false).await?;
        let entry = drive_metadata_write(
            client,
            endpoints,
            folder,
            metadata::SETTINGS,
            existing,
            bytes,
        )
        .await?;
        plan.snapshot.sync.head_revision = entry.head_revision_id.clone();
        plan.snapshot
            .sync
            .metadata_entries
            .insert(metadata::SETTINGS.into(), entry.clone());
        Some(entry)
    } else {
        head.clone()
    };
    if let Some(bytes) = plan.additions.get("manifest.json") {
        let existing = find_drive(client, endpoints, folder, "manifest.json", false).await?;
        let expected = if plan.snapshot.sync.sidecars {
            plan.snapshot.sync.metadata_entries.get("manifest.json")
        } else {
            head.as_ref()
        };
        if existing.as_ref() != expected {
            return Err("Google Drive migration changed during sync; retrying".into());
        }
        let entry =
            drive_metadata_write(client, endpoints, folder, "manifest.json", existing, bytes)
                .await?;
        plan.snapshot
            .sync
            .metadata_entries
            .insert("manifest.json".into(), entry);
    }
    plan.snapshot.sync.sidecars = true;
    // Publish tombstones before deleting content; failed uploads leave other devices readable.
    for (name, expected) in deletions {
        if plan.snapshot.manifest["nodes"]
            .as_object()
            .unwrap()
            .values()
            .any(|node| node["type"] == "file" && file_name(node).ok().as_deref() == Some(&name))
        {
            continue;
        }
        if find_drive(client, endpoints, folder, metadata::SETTINGS, false).await? != published_head
        {
            return Err("Google Drive manifest changed during sync; retrying".into());
        }
        if find_drive(client, endpoints, &files_folder, &name, false)
            .await?
            .as_ref()
            == Some(&expected)
        {
            require_success(
                client
                    .request(
                        "Google Drive delete failed",
                        Method::DELETE,
                        endpoint(&endpoints.drive, &["files", &expected.id])?,
                        None,
                    )
                    .await?,
                "Google Drive delete failed",
            )?;
        }
    }
    if deletion_journal.exists() {
        std::fs::remove_file(&deletion_journal).map_err(|error| error.to_string())?;
        crate::repository_bootstrap::sync_directory(cache_dir)?;
    }
    if journal.exists() {
        std::fs::remove_file(&journal).map_err(|error| error.to_string())?;
        crate::repository_bootstrap::sync_directory(cache_dir)?;
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
    if !snapshot.sync.sidecars {
        return Ok(false);
    }
    if find_drive(client, endpoints, folder, "manifest.json", false)
        .await?
        .as_ref()
        != snapshot.sync.metadata_entries.get("manifest.json")
    {
        return Ok(false);
    }
    let settings = find_drive(client, endpoints, folder, metadata::SETTINGS, false).await?;
    if settings
        .as_ref()
        .and_then(|entry| entry.head_revision_id.as_ref())
        != Some(head)
    {
        return Ok(false);
    }
    let files_folder = find_drive(client, endpoints, folder, "files", true).await?;
    let Some(files_folder) = files_folder else {
        return Ok(snapshot.sync.file_revisions.is_empty()
            && !snapshot
                .sync
                .metadata_entries
                .keys()
                .any(|path| metadata::is_metadata_path(path)));
    };
    let escaped = files_folder.id.replace('\\', "\\\\").replace('\'', "\\'");
    let query = format!("'{escaped}' in parents and trashed = false");
    let entries = download::list_drive(client, endpoints, &query, "1000").await?;
    let metadata_entries: HashMap<_, _> = entries
        .iter()
        .filter(|entry| entry.name.ends_with(metadata::SUFFIX))
        .map(|entry| (format!("files/{}", entry.name), entry))
        .collect();
    let known: HashMap<_, _> = snapshot
        .sync
        .metadata_entries
        .iter()
        .filter(|(path, _)| metadata::is_metadata_path(path))
        .collect();
    if metadata_entries.len() != known.len()
        || metadata_entries
            .iter()
            .any(|(path, entry)| known.get(path).copied() != Some(*entry))
    {
        return Ok(false);
    }
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
        .append_pair("fields", "id,name,headRevisionId,appProperties");
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

async fn drive_bytes_match(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    entry: Option<&DriveEntry>,
    bytes: &[u8],
) -> Result<bool, String> {
    let Some(entry) = entry else {
        return Ok(false);
    };
    let mut url = endpoint(&endpoints.drive, &["files", &entry.id])?;
    url.query_pairs_mut().append_pair("alt", "media");
    let response = require_success(
        client
            .request(
                "Google Drive metadata download failed",
                Method::GET,
                url,
                None,
            )
            .await?,
        "Google Drive metadata download failed",
    )?;
    let remote = response
        .bytes()
        .await
        .map_err(|_| "Google Drive metadata download unreadable")?;
    Ok(remote.as_ref() == bytes)
}

async fn drive_metadata_write(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    parent: &str,
    name: &str,
    existing: Option<DriveEntry>,
    bytes: &[u8],
) -> Result<DriveEntry, String> {
    if existing.is_some() {
        return drive_write(client, endpoints, parent, name, existing, bytes).await;
    }
    // Creating metadata and media together prevents an interrupted create from exposing an empty sidecar.
    let boundary = uuid::Uuid::new_v4().to_string();
    let metadata = json!({"name": name, "parents": [parent]});
    let mut body = format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n").into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let mut url = endpoint(&endpoints.drive_upload, &["files"])?;
    url.query_pairs_mut()
        .append_pair("uploadType", "multipart")
        .append_pair("fields", "id,name,headRevisionId,appProperties");
    let response = client
        .client
        .post(url)
        .bearer_auth(&client.token)
        .header(
            "Content-Type",
            format!("multipart/related; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await
        .map_err(|_| "Google Drive metadata upload failed before receiving a response")?;
    let bytes = require_success(response, "Google Drive metadata upload failed")?
        .bytes()
        .await
        .map_err(|_| "Google Drive metadata upload response unreadable")?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "Google Drive metadata upload revision unreadable".into())
}
