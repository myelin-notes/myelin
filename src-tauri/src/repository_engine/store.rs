use super::document;
use crate::repository_bootstrap::{
    download::{empty_manifest, parse_manifest},
    reject_symlink, sync_directory, valid_component,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
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
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct FileWrite {
    pub name: String,
    pub bytes: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Journal {
    manifest: Value,
    outbox: Vec<Value>,
    files: Vec<FileWrite>,
    sync: SyncState,
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
    pub manifest: Value,
    pub outbox: Vec<Value>,
    pub documents: HashMap<String, Doc>,
    pub sync: SyncState,
    pub recovery_error: Option<String>,
    pub data_version: u64,
    pub remote: bool,
    pub transaction_active: bool,
    pub blocked: Option<String>,
    pub delta_counts: HashMap<String, usize>,
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

pub(super) fn file_name(node: &Value) -> Result<String, String> {
    let id = node["id"]
        .as_str()
        .filter(|id| valid_component(id))
        .ok_or("Invalid repository node ID")?;
    let kind = node["fileType"]
        .as_str()
        .filter(|kind| valid_component(kind))
        .ok_or("Invalid repository file type")?;
    Ok(format!(
        "{id}.{}",
        if kind == "mcanvas" { "myelin" } else { kind }
    ))
}

fn io(error: std::io::Error) -> String {
    format!("Repository storage failed: {error}")
}

pub(super) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
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
    atomic_write(
        &root.join("manifest.json"),
        &serde_json::to_vec_pretty(&journal.manifest).map_err(|error| error.to_string())?,
    )?;
    atomic_write(
        &root.join("outbox.json"),
        &serde_json::to_vec(&journal.outbox).map_err(|error| error.to_string())?,
    )?;
    atomic_write(
        &root.join(".native-sync.json"),
        &serde_json::to_vec(&journal.sync).map_err(|error| error.to_string())?,
    )?;
    Ok(())
}

pub(super) fn migrate(manifest: &mut Value) {
    if manifest["version"].as_u64().unwrap_or(1) < 2 {
        manifest.as_object_mut().unwrap().remove("children");
        for node in manifest["nodes"].as_object_mut().unwrap().values_mut() {
            if let Some(node) = node.as_object_mut() {
                node.remove("children");
            }
        }
    }
    if manifest["version"].as_u64().unwrap_or(1) < 3 {
        let pen = manifest["customColors"]
            .as_array()
            .map(|colors| colors.iter().take(8).cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        manifest["colors"] = json!({"pen": pen, "highlighter": [], "text": [], "folder": []});
        manifest.as_object_mut().unwrap().remove("customColors");
    }
    manifest["version"] = json!(3);
    for key in ["linksBySource", "colors"] {
        if !manifest[key].is_object() {
            manifest[key] = json!({});
        }
    }
    for key in ["pen", "highlighter", "text", "folder"] {
        if !manifest["colors"][key].is_array() {
            manifest["colors"][key] = json!([]);
        }
    }
    if !manifest["tagRegistry"].is_array() {
        manifest["tagRegistry"] = json!([]);
    }
    let presets = manifest["penPresets"].as_array().map(|entries| entries.iter().filter_map(|entry| {
        let (min, max) = match entry["tool"].as_str()? { "pen" => (1.0, 40.0), "highlighter" => (12.0, 60.0), _ => return None };
        let color = entry["color"].as_str()?.trim();
        let color = color.strip_prefix('#').unwrap_or(color);
        if color.len() != 6 || !color.bytes().all(|byte| byte.is_ascii_hexdigit()) || !entry["id"].is_string() { return None; }
        Some(json!({"id": entry["id"], "tool": entry["tool"], "color": format!("#{}", color.to_lowercase()), "size": entry["size"].as_f64()?.clamp(min, max), "inWheel": entry["inWheel"] == true}))
    }).take(6).collect::<Vec<_>>()).unwrap_or_default();
    manifest["penPresets"] = json!(presets);
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
        let manifest_path = root.join("manifest.json");
        reject_symlink(&manifest_path)?;
        let mut manifest = if manifest_path.exists() {
            parse_manifest(&fs::read(&manifest_path).map_err(io)?)?
        } else {
            empty_manifest()
        };
        migrate(&mut manifest);
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
        };
        let directory = store.root.join(".native-updates");
        reject_symlink(&directory)?;
        if directory.exists() {
            let mut files = Vec::new();
            for entry in fs::read_dir(&directory).map_err(io)? {
                let entry = entry.map_err(io)?;
                let id = entry.file_name().to_string_lossy().to_string();
                if store.manifest["nodes"][&id]["fileType"] == "mcanvas" {
                    let bytes = store.read_file(&store.manifest["nodes"][&id])?;
                    files.push(FileWrite {
                        name: file_name(&store.manifest["nodes"][&id])?,
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

    pub fn manifest_revision(&self) -> String {
        revision(&serde_json::to_vec(&self.manifest).unwrap())
    }

    pub fn read_file(&self, node: &Value) -> Result<Vec<u8>, String> {
        if node["fileType"] == "mcanvas" {
            if let Some(doc) = node["id"].as_str().and_then(|id| self.documents.get(id)) {
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
        if node["fileType"] == "mcanvas" {
            let id = node["id"].as_str().ok_or("Invalid repository node ID")?;
            let directory = self.root.join(".native-updates").join(id);
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

    pub fn doc(&mut self, id: &str) -> Result<&Doc, String> {
        if !self.documents.contains_key(id) {
            let node = &self.manifest["nodes"][id];
            if node["type"] != "file" || node["fileType"] != "mcanvas" {
                return Err("Cannot open this file as a canvas document".into());
            }
            self.documents
                .insert(id.into(), document::decode(&self.read_file(node)?)?);
        }
        Ok(&self.documents[id])
    }

    pub fn queue(&mut self, kind: &str, id: Option<&str>, fields: Value) {
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
        if self.manifest["nodes"][id]["system"].is_null() {
            if links.is_empty() {
                self.manifest["linksBySource"]
                    .as_object_mut()
                    .unwrap()
                    .remove(id);
            } else {
                self.manifest["linksBySource"][id] = json!(links);
            }
        }
        self.manifest["nodes"][id]["modifiedAt"] = json!(now());
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
        let count = self.delta_counts.entry(id.into()).or_default();
        *count += 1;
        if *count >= 64 {
            let bytes = document::bytes(self.doc(id)?);
            return self.commit(vec![FileWrite {
                name: file_name(&self.manifest["nodes"][id])?,
                bytes: Some(STANDARD.encode(bytes)),
            }]);
        }
        self.commit_journal(
            Vec::new(),
            vec![DeltaWrite {
                node_id: id.into(),
                id: uuid::Uuid::new_v4().to_string(),
                bytes: STANDARD.encode(bytes),
            }],
        )
    }

    fn commit_journal(
        &mut self,
        files: Vec<FileWrite>,
        updates: Vec<DeltaWrite>,
    ) -> Result<(), String> {
        self.transaction_active = true;
        let journal = Journal {
            manifest: self.manifest.clone(),
            outbox: self.outbox.clone(),
            files,
            sync: self.sync.clone(),
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
        Some("sync-custom-colors" | "sync-tag-registry" | "sync-pen-presets") => true,
        _ => false,
    }
}
