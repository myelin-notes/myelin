use super::{document, media};
use crate::repository_bootstrap::{reject_symlink, sync_directory, valid_component};
use crate::repository_metadata::{self as metadata, Manifest, Node};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use yrs::Doc;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SyncState {
    pub last_remote_sync_at: Option<u64>,
    pub head_revision: Option<String>,
    #[serde(default)]
    pub file_revisions: HashMap<String, Option<String>>,
    #[serde(default)]
    pub basis_id: Option<String>,
    #[serde(default)]
    pub file_ids: HashMap<String, String>,
    #[serde(default)]
    pub document_generations: HashMap<String, String>,
    #[serde(default)]
    pub sidecars: bool,
    #[serde(default)]
    pub metadata_entries: HashMap<String, crate::repository_bootstrap::download::DriveEntry>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct FileWrite {
    pub name: String,
    pub bytes: Option<String>,
}

// A staged file's bytes already sit in `staged_path`; an unstaged one is a deletion. `bytes` is
// only read, for a journal left behind by a version that inlined file bytes.
#[derive(Serialize, Deserialize)]
struct JournalFile {
    name: String,
    #[serde(default)]
    staged: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bytes: Option<String>,
}

fn staged_path(root: &Path, name: &str) -> PathBuf {
    root.join("files").join(format!(".{name}.journal.tmp"))
}

#[derive(Serialize, Deserialize)]
struct Journal {
    #[serde(default)]
    metadata: Vec<FileWrite>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    outbox: Option<Vec<Value>>,
    files: Vec<JournalFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sync: Option<SyncState>,
    #[serde(default)]
    updates: Vec<DeltaWrite>,
}

#[derive(Serialize, Deserialize)]
struct DeltaWrite {
    node_id: String,
    id: String,
    bytes: String,
}

pub(super) struct Store {
    pub root: PathBuf,
    pub manifest: Manifest,
    pub outbox: Vec<Value>,
    pub documents: HashMap<String, Doc>,
    pub sync: SyncState,
    pub recovery_error: Option<String>,
    pub data_version: u64,
    pub remote: bool,
    pub transaction_active: bool,
    pub blocked: Option<String>,
    pub delta_counts: HashMap<String, usize>,
    persisted_metadata: HashMap<String, Vec<u8>>,
    persisted_sync: Vec<u8>,
    persisted_outbox: Vec<u8>,
    marker_written: bool,
    dirty_nodes: HashSet<String>,
    dirty_settings: bool,
    metadata_epoch: String,
    metadata_version: u64,
}

pub(super) fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(super) fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn file_name(node: &Node) -> Result<String, String> {
    file_name_for(&node.id, node.file_type.as_deref().unwrap_or_default())
}

pub(super) fn file_name_for(id: &str, kind: &str) -> Result<String, String> {
    if !valid_component(id) {
        return Err("Invalid repository node ID".into());
    }
    if !valid_component(kind) || kind == "meta.json" {
        return Err("Invalid repository file type".into());
    }
    Ok(format!(
        "{id}.{}",
        if kind == "mcanvas" { "myelin" } else { kind }
    ))
}

fn io(error: std::io::Error) -> String {
    format!("Repository storage failed: {error}")
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    reject_symlink(path)?;
    let temporary = path.with_file_name(format!(
        ".{}.native.tmp",
        path.file_name()
            .ok_or("Invalid repository storage path")?
            .to_string_lossy()
    ));
    reject_symlink(&temporary)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temporary)
        .map_err(io)?;
    use std::io::Write;
    file.write_all(bytes).map_err(io)?;
    file.sync_all().map_err(io)?;
    drop(file);
    fs::rename(temporary, path).map_err(io)?;
    sync_directory(path.parent().ok_or("Invalid repository storage path")?)
}

// Source is durable and the destination is not yet exposed by metadata.
pub(super) fn install_download(path: &Path, source: &Path) -> Result<(), String> {
    reject_symlink(source)?;
    reject_symlink(path)?;
    let temporary = path.with_file_name(format!(
        ".{}.import.tmp",
        path.file_name()
            .ok_or("Invalid repository storage path")?
            .to_string_lossy()
    ));
    reject_symlink(&temporary)?;
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(io)?;
    }
    if fs::hard_link(source, &temporary).is_err() {
        fs::copy(source, &temporary).map_err(io)?;
        fs::File::open(&temporary)
            .map_err(io)?
            .sync_all()
            .map_err(io)?;
    }
    fs::rename(&temporary, path).map_err(io)?;
    sync_directory(path.parent().ok_or("Invalid repository storage path")?)
}

fn apply_journal(root: &Path, journal: &Journal) -> Result<(), String> {
    for write in &journal.files {
        if !valid_component(&write.name) {
            return Err("Invalid repository journal file path".into());
        }
        let path = root.join("files").join(&write.name);
        reject_symlink(&path)?;
        if let Some(bytes) = &write.bytes {
            atomic_write(
                &path,
                &STANDARD
                    .decode(bytes)
                    .map_err(|_| "Invalid repository journal bytes")?,
            )?;
        } else if write.staged {
            // Already renamed when a crash interrupted an earlier replay of this journal.
            let staged = staged_path(root, &write.name);
            if staged.exists() {
                reject_symlink(&staged)?;
                fs::rename(&staged, &path).map_err(io)?;
                sync_directory(&root.join("files"))?;
            }
        } else if path.exists() {
            fs::remove_file(path).map_err(io)?;
        }
        if let Some(id) = write.name.strip_suffix(".myelin") {
            let updates = root.join(".native-updates").join(id);
            reject_symlink(&root.join(".native-updates"))?;
            reject_symlink(&updates)?;
            if updates.exists() {
                fs::remove_dir_all(&updates).map_err(io)?;
                sync_directory(&root.join(".native-updates"))?;
            }
        }
    }
    for update in &journal.updates {
        if !valid_component(&update.node_id) || !valid_component(&update.id) {
            return Err("Invalid native document journal path".into());
        }
        let updates = root.join(".native-updates");
        reject_symlink(&updates)?;
        let directory = updates.join(&update.node_id);
        reject_symlink(&directory)?;
        fs::create_dir_all(&directory).map_err(io)?;
        sync_directory(&updates)?;
        sync_directory(root)?;
        atomic_write(
            &directory.join(format!("{}.update", update.id)),
            &STANDARD
                .decode(&update.bytes)
                .map_err(|_| "Invalid native document journal update")?,
        )?;
    }
    for write in &journal.metadata {
        if !metadata::is_metadata_path(&write.name)
            && !matches!(write.name.as_str(), metadata::SETTINGS | "manifest.json")
        {
            return Err("Invalid repository metadata journal path".into());
        }
        let bytes = STANDARD
            .decode(
                write
                    .bytes
                    .as_ref()
                    .ok_or("Missing metadata journal bytes")?,
            )
            .map_err(|_| "Invalid metadata journal bytes")?;
        atomic_write(&root.join(&write.name), &bytes)?;
    }
    if let Some(outbox) = &journal.outbox {
        atomic_write(
            &root.join("outbox.json"),
            &serde_json::to_vec(outbox).map_err(|error| error.to_string())?,
        )?;
    }
    if let Some(sync) = &journal.sync {
        atomic_write(
            &root.join(".native-sync.json"),
            &serde_json::to_vec(sync).map_err(|error| error.to_string())?,
        )?;
    }
    Ok(())
}

impl Store {
    pub fn open(root: PathBuf, remote: bool) -> Result<Self, String> {
        reject_symlink(&root)?;
        fs::create_dir_all(&root).map_err(io)?;
        reject_symlink(&root.join("files"))?;
        fs::create_dir_all(root.join("files")).map_err(io)?;
        let journal = root.join(".native-journal.json");
        reject_symlink(&journal)?;
        if journal.exists() {
            let saved: Journal = serde_json::from_slice(&fs::read(&journal).map_err(io)?)
                .map_err(|_| "Repository journal requires recovery")?;
            apply_journal(&root, &saved)?;
            fs::remove_file(&journal).map_err(io)?;
        }
        for entry in fs::read_dir(root.join("files")).map_err(io)? {
            let entry = entry.map_err(io)?;
            if entry
                .file_name()
                .to_string_lossy()
                .ends_with(".journal.tmp")
            {
                reject_symlink(&entry.path())?;
                fs::remove_file(entry.path()).map_err(io)?;
            }
        }
        let loaded = metadata::load(&root)?;
        let manifest = loaded.manifest;
        let marker_written =
            metadata::is_marker(&fs::read(root.join("manifest.json")).unwrap_or_default());
        let outbox_path = root.join("outbox.json");
        reject_symlink(&outbox_path)?;
        let mut recovery_error: Option<String> = None;
        let mut outbox: Vec<Value> = if outbox_path.exists() {
            match serde_json::from_slice::<Vec<Value>>(&fs::read(&outbox_path).map_err(io)?) {
                Ok(ops) if ops.iter().all(valid_op) => ops,
                _ => {
                    let quarantined = root.join(format!("outbox.corrupt.{}.json", now()));
                    fs::rename(&outbox_path, &quarantined).map_err(io)?;
                    recovery_error = Some(
                        "Cached repository outbox requires recovery; remote sync is paused".into(),
                    );
                    atomic_write(
                        &root.join(".native-recovery-error"),
                        recovery_error.as_ref().unwrap().as_bytes(),
                    )?;
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        };
        if root.join(".native-recovery-error").exists() {
            recovery_error =
                Some(fs::read_to_string(root.join(".native-recovery-error")).map_err(io)?);
        }
        if !loaded.corrupt.is_empty() {
            recovery_error = Some(format!(
                "Repository metadata requires recovery; remote sync is paused: {}",
                loaded.corrupt.join(", ")
            ));
            atomic_write(
                &root.join(".native-recovery-error"),
                recovery_error.as_ref().unwrap().as_bytes(),
            )?;
            for path in &loaded.corrupt {
                match fs::rename(
                    root.join(path),
                    root.join(format!(
                        "metadata.corrupt.{}.{}.json",
                        now(),
                        path.replace('/', "_")
                    )),
                ) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(io(error)),
                }
            }
        }
        for op in &mut outbox {
            if !op["queueRevision"]
                .as_str()
                .is_some_and(|revision| !revision.is_empty())
            {
                op["queueRevision"] = json!(uuid::Uuid::new_v4().to_string());
            }
        }
        let mut sync = if root.join(".native-sync.json").exists() {
            serde_json::from_slice(&fs::read(root.join(".native-sync.json")).map_err(io)?)
                .map_err(|_| "Unreadable native repository sync state")?
        } else {
            SyncState::default()
        };
        if sync.last_remote_sync_at.is_none() && root.join("outbox.json.sync-status.json").exists()
        {
            sync.last_remote_sync_at = serde_json::from_slice(
                &fs::read(root.join("outbox.json.sync-status.json")).map_err(io)?,
            )
            .ok();
        }
        let mut store = Self {
            dirty_nodes: manifest
                .nodes
                .keys()
                .chain(manifest.deleted_nodes.keys())
                .cloned()
                .collect(),
            dirty_settings: true,
            metadata_epoch: uuid::Uuid::new_v4().to_string(),
            metadata_version: 0,
            persisted_sync: fs::read(root.join(".native-sync.json")).unwrap_or_default(),
            persisted_outbox: fs::read(root.join("outbox.json")).unwrap_or_default(),
            root,
            manifest,
            outbox,
            sync,
            documents: HashMap::new(),
            recovery_error,
            data_version: 0,
            remote,
            transaction_active: false,
            blocked: None,
            delta_counts: HashMap::new(),
            persisted_metadata: loaded.records,
            marker_written,
        };
        let directory = store.root.join(".native-updates");
        reject_symlink(&directory)?;
        if directory.exists() {
            let mut files = Vec::new();
            for entry in fs::read_dir(&directory).map_err(io)? {
                let entry = entry.map_err(io)?;
                let id = entry.file_name().to_string_lossy().to_string();
                if let Some(node) = store.manifest.node(&id).filter(|node| node.is_canvas()) {
                    let bytes = store.read_file(node)?;
                    files.push(FileWrite {
                        name: file_name(node)?,
                        bytes: Some(STANDARD.encode(bytes)),
                    });
                }
            }
            if !files.is_empty() {
                store.commit(files)?;
            }
        }
        store.commit(vec![])?;
        Ok(store)
    }

    pub fn metadata_revision(&self) -> String {
        format!("{}:{}", self.metadata_epoch, self.metadata_version)
    }

    pub fn mark_node(&mut self, id: &str) {
        self.dirty_nodes.insert(id.to_owned());
    }

    pub fn replace_metadata(&mut self, next: Manifest) {
        self.dirty_nodes
            .extend(metadata::changed_nodes(&self.manifest, &next));
        self.dirty_settings = true;
        self.manifest = next;
    }

    pub fn metadata_records(&self) -> HashMap<String, Vec<u8>> {
        self.persisted_metadata.clone()
    }

    pub fn read_file(&self, node: &Node) -> Result<Vec<u8>, String> {
        if node.is_canvas() {
            if let Some(doc) = self.documents.get(&node.id) {
                return Ok(document::bytes(doc));
            }
        }
        let path = self.root.join("files").join(file_name(node)?);
        reject_symlink(&path)?;
        let mut bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(io(error)),
        };
        if node.is_canvas() {
            if let Cow::Owned(inlined) = media::inline(&bytes, |hash| self.read_media(hash)) {
                bytes = inlined;
            }
            let directory = self.root.join(".native-updates").join(&node.id);
            reject_symlink(&self.root.join(".native-updates"))?;
            reject_symlink(&directory)?;
            if directory.exists() {
                let doc = document::decode(&bytes)?;
                for entry in fs::read_dir(directory).map_err(io)? {
                    let entry = entry.map_err(io)?;
                    if entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension == "update")
                    {
                        reject_symlink(&entry.path())?;
                        document::apply(&doc, &fs::read(entry.path()).map_err(io)?)?;
                    }
                }
                bytes = document::bytes(&doc);
            }
        }
        Ok(bytes)
    }

    pub fn read_media(&self, hash: &str) -> Option<Vec<u8>> {
        let path = self
            .root
            .join("files")
            .join(file_name(&media::node(hash, 0)).ok()?);
        reject_symlink(&path).ok()?;
        fs::read(path).ok()
    }

    // Media reaches disk before the journal that references it, so a crash leaves only an
    // unreferenced file that the next write reuses.
    fn extract_media(&mut self, files: &mut [FileWrite]) -> Result<(), String> {
        for file in files {
            let (true, Some(encoded)) = (file.name.ends_with(".myelin"), &file.bytes) else {
                continue;
            };
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| "Invalid repository file bytes")?;
            let extracted = media::extract(&bytes);
            if extracted.media.is_empty() {
                continue;
            }
            for (hash, bytes) in &extracted.media {
                let node = media::node(hash, bytes.len());
                let path = self.root.join("files").join(file_name(&node)?);
                if !path.exists() {
                    atomic_write(&path, bytes)?;
                }
                if self.manifest.node(hash).is_none() {
                    self.manifest.nodes.insert(hash.into(), node);
                    self.queue("upsert-manifest-node", Some(hash), json!({}));
                    self.queue("push-note", Some(hash), json!({"baseFileRevision": null}));
                }
            }
            file.bytes = Some(STANDARD.encode(&extracted.document));
        }
        Ok(())
    }

    /// Documents big enough to hold inline media, with where each is stored.
    pub fn documents_large_enough_for_media(&self) -> Result<Vec<(String, PathBuf)>, String> {
        let mut documents = Vec::new();
        for (id, node) in &self.manifest.nodes {
            if node.is_file() && node.is_canvas() {
                let path = self.root.join("files").join(file_name(node)?);
                if fs::metadata(&path).is_ok_and(|file| file.len() as usize >= media::MIN_BYTES) {
                    documents.push((id.clone(), path));
                }
            }
        }
        Ok(documents)
    }

    /// Rewrites a document stored with inline media and queues it for upload. Returns the size of the
    /// complete document, which is what a sync has to hold in memory to upload it.
    pub fn extract_document_media(&mut self, id: &str) -> Result<usize, String> {
        let Some(node) = self
            .manifest
            .node(id)
            .filter(|node| node.is_canvas())
            .cloned()
        else {
            return Ok(0);
        };
        let name = file_name(&node)?;
        let path = self.root.join("files").join(&name);
        reject_symlink(&path)?;
        if !fs::read(path).is_ok_and(|stored| media::has_inline_media(&stored)) {
            return Ok(0);
        }
        let bytes = self.read_file(&node)?;
        self.queue("push-note", Some(id), json!({}));
        self.commit(vec![FileWrite {
            name,
            bytes: Some(STANDARD.encode(&bytes)),
        }])?;
        Ok(bytes.len())
    }

    pub fn doc(&mut self, id: &str) -> Result<&Doc, String> {
        if !self.documents.contains_key(id) {
            let Some(node) = self.manifest.file(id).filter(|node| node.is_canvas()) else {
                return Err("Cannot open this file as a canvas document".into());
            };
            self.documents
                .insert(id.into(), document::decode(&self.read_file(node)?)?);
        }
        Ok(&self.documents[id])
    }

    pub fn queue(&mut self, kind: &str, id: Option<&str>, fields: Value) {
        match kind {
            "upsert-manifest-node" | "delete-manifest-node" => {
                if let Some(id) = id {
                    self.mark_node(id);
                }
            }
            "sync-custom-colors" | "sync-tag-registry" | "sync-pen-presets" | "sync-flag-types"
            | "sync-live-secret" => self.dirty_settings = true,
            _ => {}
        }
        if !self.remote {
            return;
        }
        if let Some(op) = self
            .outbox
            .iter_mut()
            .find(|op| op["kind"] == kind && (id.is_none() || op["nodeId"] == id.unwrap()))
        {
            op["queueRevision"] = json!(uuid::Uuid::new_v4().to_string());
            if fields["replaceFile"] == true {
                op["replaceFile"] = json!(true);
                op.as_object_mut().unwrap().remove("baseFileRevision");
            }
            return;
        }
        let mut op = fields;
        if !op.is_object() {
            op = json!({});
        }
        op["kind"] = json!(kind);
        op["queueRevision"] = json!(uuid::Uuid::new_v4().to_string());
        if let Some(id) = id {
            op["nodeId"] = json!(id);
        }
        self.outbox.push(op);
    }

    pub fn touch_document(&mut self, id: &str, enqueue: bool) -> Result<(), String> {
        let links = document::links(self.doc(id)?);
        let node = self
            .manifest
            .node_mut(id)
            .ok_or("Unknown repository node")?;
        node.modified_at = now().into();
        if node.system.is_none() {
            if links.is_empty() {
                self.manifest.links_by_source.remove(id);
            } else {
                self.manifest.links_by_source.insert(id.into(), links);
            }
        }
        self.mark_node(id);
        if enqueue {
            self.queue("push-note", Some(id), json!({}));
            self.queue("upsert-manifest-node", Some(id), json!({}));
        }
        Ok(())
    }

    pub fn commit(&mut self, files: Vec<FileWrite>) -> Result<(), String> {
        for file in &files {
            if let Some(id) = file.name.strip_suffix(".myelin") {
                self.delta_counts.remove(id);
            }
        }
        self.commit_journal(files, Vec::new())
    }

    pub fn commit_update(&mut self, id: &str, bytes: &[u8]) -> Result<(), String> {
        self.commit_updates(vec![(id.into(), bytes.to_vec())])
    }

    pub fn commit_updates(&mut self, updates: Vec<(String, Vec<u8>)>) -> Result<(), String> {
        let mut files = Vec::new();
        let mut deltas = Vec::new();
        for (id, bytes) in updates {
            let count = self.delta_counts.entry(id.clone()).or_default();
            *count += 1;
            if *count >= 64 {
                let bytes = document::bytes(self.doc(&id)?);
                let node = self.manifest.node(&id).ok_or("Unknown repository node")?;
                files.push(FileWrite {
                    name: file_name(node)?,
                    bytes: Some(STANDARD.encode(bytes)),
                });
                self.delta_counts.remove(&id);
            } else {
                deltas.push(DeltaWrite {
                    node_id: id,
                    id: uuid::Uuid::new_v4().to_string(),
                    bytes: STANDARD.encode(bytes),
                });
            }
        }
        self.commit_journal(files, deltas)
    }

    fn commit_journal(
        &mut self,
        mut files: Vec<FileWrite>,
        updates: Vec<DeltaWrite>,
    ) -> Result<(), String> {
        self.transaction_active = true;
        self.extract_media(&mut files)?;
        let dirty: Vec<_> = self.dirty_nodes.iter().cloned().collect();
        let mut records = HashMap::new();
        for id in &dirty {
            if self.manifest.node(id).is_none() {
                if !self.manifest.is_deleted(id) {
                    let revision = self
                        .outbox
                        .iter()
                        .find(|op| op["kind"] == "delete-manifest-node" && op["nodeId"] == *id)
                        .and_then(|op| op["queueRevision"].as_str().map(str::to_owned))
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                    self.manifest.deleted_nodes.insert(id.clone(), revision);
                }
            } else if let Some(deletion) = self.manifest.deleted_nodes.remove(id) {
                self.manifest.restored_nodes.insert(id.clone(), deletion);
            }
            records.insert(
                format!("files/{id}{}", metadata::SUFFIX),
                metadata::node_record(&self.manifest, id)?,
            );
        }
        if self.dirty_settings {
            records.insert(
                metadata::SETTINGS.into(),
                metadata::settings(&self.manifest)?,
            );
        }
        let mut writes: Vec<FileWrite> = records
            .iter()
            .filter(|(path, bytes)| self.persisted_metadata.get(*path) != Some(*bytes))
            .map(|(path, bytes)| FileWrite {
                name: path.clone(),
                bytes: Some(STANDARD.encode(bytes)),
            })
            .collect();
        if !self.marker_written {
            writes.push(FileWrite {
                name: "manifest.json".into(),
                bytes: Some(STANDARD.encode(metadata::MARKER)),
            });
        }
        let outbox_bytes = serde_json::to_vec(&self.outbox).map_err(|e| e.to_string())?;
        let sync_bytes = serde_json::to_vec(&self.sync).map_err(|e| e.to_string())?;
        let mut staged_files = Vec::new();
        for file in files {
            if !valid_component(&file.name) {
                return Err("Invalid repository journal file path".into());
            }
            let staged = file.bytes.is_some();
            if let Some(bytes) = &file.bytes {
                atomic_write(
                    &staged_path(&self.root, &file.name),
                    &STANDARD
                        .decode(bytes)
                        .map_err(|_| "Invalid repository file bytes")?,
                )?;
            }
            staged_files.push(JournalFile {
                name: file.name,
                staged,
                bytes: None,
            });
        }
        let journal = Journal {
            metadata: writes,
            outbox: (self.persisted_outbox != outbox_bytes).then(|| self.outbox.clone()),
            files: staged_files,
            sync: (self.persisted_sync != sync_bytes).then(|| self.sync.clone()),
            updates,
        };
        let path = self.root.join(".native-journal.json");
        atomic_write(
            &path,
            &serde_json::to_vec(&journal).map_err(|error| error.to_string())?,
        )?;
        apply_journal(&self.root, &journal)?;
        fs::remove_file(path).map_err(io)?;
        sync_directory(&self.root)?;
        self.persisted_metadata.extend(records);
        if !journal.metadata.is_empty() {
            self.metadata_version += 1;
        }
        self.dirty_nodes.clear();
        self.dirty_settings = false;
        self.persisted_sync = sync_bytes;
        self.persisted_outbox = outbox_bytes;
        self.marker_written = true;
        self.data_version += 1;
        self.transaction_active = false;
        Ok(())
    }
}

fn valid_op(op: &Value) -> bool {
    match op["kind"].as_str() {
        Some("push-note" | "upsert-manifest-node") => {
            op["nodeId"].as_str().is_some_and(valid_component)
        }
        Some("delete-manifest-node") => {
            op["nodeId"].as_str().is_some_and(valid_component)
                && op["deletedFileIds"].as_array().is_some_and(|ids| {
                    ids.iter()
                        .all(|id| id.as_str().is_some_and(valid_component))
                })
        }
        Some(
            "sync-custom-colors" | "sync-tag-registry" | "sync-pen-presets" | "sync-flag-types"
            | "sync-live-secret",
        ) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_replays_staged_journal_and_drops_stale_staging() {
        let root = std::env::temp_dir().join(format!("myelin-journal-{}", uuid::Uuid::new_v4()));
        drop(Store::open(root.clone(), false).unwrap());
        fs::write(staged_path(&root, "x.png"), b"staged bytes").unwrap();
        fs::write(staged_path(&root, "stale.png"), b"never journaled").unwrap();
        fs::write(
            root.join(".native-journal.json"),
            br#"{"files":[{"name":"x.png","staged":true}]}"#,
        )
        .unwrap();

        drop(Store::open(root.clone(), false).unwrap());

        assert_eq!(fs::read(root.join("files/x.png")).unwrap(), b"staged bytes");
        assert!(!staged_path(&root, "x.png").exists());
        assert!(!staged_path(&root, "stale.png").exists());
        assert!(!root.join(".native-journal.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
