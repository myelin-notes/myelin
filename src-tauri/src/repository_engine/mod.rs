mod document;
mod flags;
mod media;
mod media_cleanup;
mod onenote;
mod references;
mod remote;
pub(crate) mod store;
pub(crate) mod telemetry;
#[cfg(test)]
mod tests;
mod transfer;
mod version_history;

use crate::import_files::FileImportSource;
use crate::repository_bootstrap::{download::RepositorySource, CachePaths};
use crate::repository_metadata::Node;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use store::{file_name, revision, FileWrite, Store};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex as AsyncMutex, Notify};

#[derive(Default)]
pub struct RepositoryManager {
    engines: AsyncMutex<HashMap<String, Arc<RepositoryEngine>>>,
    handles: AsyncMutex<HashMap<String, RepositoryHandle>>,
    auth: AsyncMutex<HashMap<String, oneshot::Sender<Result<String, String>>>>,
}

struct RepositoryHandle {
    engine: Arc<RepositoryEngine>,
    notes: HashMap<String, HashSet<String>>,
    transfers: HashMap<String, Vec<u8>>,
}

pub(crate) struct RepositoryEngine {
    id: String,
    store: Arc<Mutex<Store>>,
    source: AsyncMutex<Option<RepositorySource>>,
    credential_id: Mutex<String>,
    network_lock: AsyncMutex<()>,
    open_notes: Arc<Mutex<HashMap<String, HashSet<String>>>>,
    references: AtomicUsize,
    scheduling: AtomicBool,
    checkpoint_scheduling: AtomicBool,
    wake: Notify,
    online: AtomicBool,
    syncing: AtomicBool,
    // Millis of the last sync that confirmed the remote, including no-op checks; 0 = none yet.
    last_checked_at: AtomicU64,
    error: Mutex<Option<String>>,
    media_migration: Mutex<Option<MediaMigration>>,
    // Last error reported per background task, so a retry loop reports each failure once.
    reported_errors: Mutex<HashMap<&'static str, String>>,
    cache_dir: PathBuf,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataPatch {
    nodes: Vec<NodeMetadata>,
    deleted_node_ids: Vec<String>,
    settings: Option<RepositoryPreferences>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NodeMetadata {
    node: Node,
    links: Vec<Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RepositoryPreferences {
    colors: Value,
    tag_registry: Vec<String>,
    pen_presets: Vec<Value>,
    flag_types: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    live_secret: Option<String>,
}

fn stored_path(state: &Store, node_id: &str) -> Result<Value, String> {
    let Some(node) = state.manifest.file(node_id) else {
        return Ok(Value::Null);
    };
    Ok(json!(state
        .root
        .join("files")
        .join(file_name(node)?)
        .to_string_lossy()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRepositoryRequest {
    storage_root: String,
    credential_id: String,
    source: Option<RepositorySource>,
}

// How much one sync may have to hold in memory while existing documents migrate.
const MEDIA_BATCH_BYTES: usize = if cfg!(test) {
    8 * 1024
} else {
    64 * 1024 * 1024
};

// A `total` of 0 means the documents to migrate are still being counted.
#[derive(Clone, Serialize)]
struct MediaMigration {
    completed: usize,
    total: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeStatus {
    repository_id: String,
    online: bool,
    pending_remote_writes: usize,
    last_remote_sync_at: Option<u64>,
    last_error: Option<String>,
    data_version: u64,
    syncing: bool,
    media_migration: Option<MediaMigration>,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum RepositoryOperation {
    Manifest,
    SaveMetadata {
        patch: MetadataPatch,
        revision: String,
    },
    ReadFile {
        node_id: String,
    },
    WriteFile {
        node: Node,
        bytes_base64: String,
        replace: bool,
        overwrite_remote: bool,
    },
    ImportOneNote {
        path: tauri_plugin_fs::FilePath,
        parent_id: Option<String>,
        root_name: String,
        fallback_title: String,
        progress: tauri::ipc::JavaScriptChannelId,
    },
    #[serde(skip)]
    ImportedOneNote {
        notebook: crate::onenote_import::ImportedNotebook,
        parent_id: Option<String>,
        root_name: String,
        fallback_title: String,
        progress: tauri::ipc::Channel<Value>,
    },
    ImportFile {
        node: Node,
        source: FileImportSource,
    },
    #[serde(skip)]
    ImportedFile {
        node: Node,
        bytes: Vec<u8>,
    },
    RenameReferences {
        source_ids: Vec<String>,
        target_id: String,
        new_name: String,
        reference_kind: references::ReferenceKind,
    },
    EditFlags {
        /// Flag ids by canvas node id.
        flag_ids: HashMap<String, HashSet<String>>,
        edit: flags::FlagEdit,
    },
    StageBytes {
        transfer_id: String,
        offset: usize,
        bytes_base64: String,
    },
    FinishTransfer {
        transfer_id: String,
        operation: Box<RepositoryOperation>,
    },
    CancelTransfer {
        transfer_id: String,
    },
    CreateFileVersion {
        node_id: String,
        force: bool,
    },
    RestoreFileVersion {
        node_id: String,
        version_id: String,
    },
    DeleteFile {
        node_id: String,
        file_type: Option<String>,
    },
    Document {
        node_id: String,
        state_vector_base64: Option<String>,
    },
    CheckpointDocument {
        node_id: String,
    },
    UpdateDocument {
        node_id: String,
        update_base64: String,
        origin: String,
        generation: Option<String>,
        source_session: Option<String>,
    },
    Subscribe {
        node_id: String,
        session_id: String,
    },
    Unsubscribe {
        node_id: String,
        session_id: String,
    },
    Path {
        node_id: String,
    },
    Paths {
        node_ids: Vec<String>,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentChange {
    repository_id: String,
    node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    update_base64: Option<String>,
    origin: String,
    generation: String,
    replacement: bool,
}

struct DocumentNotification {
    node_id: String,
    bytes: Vec<u8>,
    source_session: Option<String>,
    origin: String,
    generation: String,
    replacement: bool,
}

#[derive(Default)]
struct Changes {
    documents: Vec<DocumentNotification>,
    deleted: Vec<String>,
    changed: Vec<String>,
    wake_remote: bool,
}

impl RepositoryManager {
    async fn engine(&self, handle: &str) -> Result<Arc<RepositoryEngine>, String> {
        self.handles
            .lock()
            .await
            .get(handle)
            .map(|handle| handle.engine.clone())
            .ok_or_else(|| "Repository handle is closed".into())
    }
    async fn token(
        &self,
        app: &AppHandle,
        engine: &RepositoryEngine,
        force_refresh: bool,
    ) -> Result<String, String> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let credential_id = engine.credential_id.lock().unwrap().clone();
        let (sender, receiver) = oneshot::channel();
        self.auth.lock().await.insert(request_id.clone(), sender);
        if let Err(error) = app.emit("repository-auth-request", json!({"repositoryId": engine.id, "credentialId": credential_id, "requestId": request_id, "forceRefresh": force_refresh})) {
            self.auth.lock().await.remove(&request_id);
            return Err(error.to_string());
        }
        let result = tokio::time::timeout(std::time::Duration::from_secs(30), receiver).await;
        self.auth.lock().await.remove(&request_id);
        result
            .map_err(|_| "Repository authentication timed out")?
            .map_err(|_| "Repository authentication was cancelled")?
    }
}

impl RepositoryEngine {
    async fn with_store<T: Send + 'static>(
        &self,
        action: impl FnOnce(&mut Store) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let store = self.store.clone();
        let open_notes = self.open_notes.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut state = store
                .lock()
                .map_err(|_| "Repository storage lock unavailable")?;
            if let Some(error) = &state.blocked {
                return Err(error.clone());
            }
            let result = action(&mut state);
            if result.is_err() && state.transaction_active {
                let root = state.root.clone();
                let remote = state.remote;
                let version = state.data_version;
                match Store::open(root, remote) {
                    Ok(mut restored) => {
                        restored.data_version = version + 1;
                        *state = restored;
                    }
                    Err(error) => {
                        state.blocked =
                            Some(format!("Repository durability requires recovery: {error}"));
                    }
                }
            }
            let notes = open_notes.lock().unwrap();
            let Store {
                documents,
                delta_counts,
                ..
            } = &mut *state;
            documents.retain(|id, _| notes.contains_key(id) || delta_counts.contains_key(id));
            result
        })
        .await
        .map_err(|error| error.to_string())?
    }

    async fn status(&self) -> NativeStatus {
        let state = self.store.clone();
        let (pending, last, recovery, version) = tauri::async_runtime::spawn_blocking(move || {
            let store = state.lock().unwrap();
            (
                store.outbox.len(),
                store.sync.last_remote_sync_at,
                store
                    .blocked
                    .clone()
                    .or_else(|| store.recovery_error.clone()),
                store.data_version,
            )
        })
        .await
        .unwrap();
        NativeStatus {
            repository_id: self.id.clone(),
            online: self.online.load(Ordering::Relaxed) && recovery.is_none(),
            pending_remote_writes: pending,
            last_remote_sync_at: last.max(
                Some(self.last_checked_at.load(Ordering::Relaxed)).filter(|&checked| checked > 0),
            ),
            last_error: recovery.or_else(|| self.error.lock().unwrap().clone()),
            data_version: version,
            syncing: self.syncing.load(Ordering::Relaxed),
            media_migration: self.media_migration.lock().unwrap().clone(),
        }
    }

    async fn emit_changes(&self, app: &AppHandle, changes: Changes) {
        let local_mutation = changes.wake_remote;
        let _ = app.emit("repository-status", self.status().await);
        let _ = app.emit("repository-data", json!({"repositoryId": self.id, "changed": changes.changed, "deleted": changes.deleted}));
        for notification in changes.documents {
            self.emit_document_change(&notification, |event, payload| {
                let _ = app.emit(event, payload);
            });
            if notification.origin == "local" {
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
        }
        if local_mutation {
            self.wake.notify_one();
        }
    }

    fn emit_document_change(
        &self,
        notification: &DocumentNotification,
        mut emit: impl FnMut(&str, &DocumentChange),
    ) {
        let sessions = self
            .open_notes
            .lock()
            .unwrap()
            .get(&notification.node_id)
            .into_iter()
            .flatten()
            .filter(|session| notification.source_session.as_ref() != Some(*session))
            .cloned()
            .collect::<Vec<_>>();
        if sessions.is_empty() {
            return;
        }
        let payload = DocumentChange {
            repository_id: self.id.clone(),
            node_id: notification.node_id.clone(),
            update_base64: (!notification.replacement)
                .then(|| STANDARD.encode(&notification.bytes)),
            origin: notification.origin.clone(),
            generation: notification.generation.clone(),
            replacement: notification.replacement,
        };
        for session in sessions {
            emit(&format!("repository-document-{session}"), &payload);
        }
    }

    fn report_background_error<T, R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        message: &'static str,
        result: &Result<T, String>,
    ) {
        let mut reported = self.reported_errors.lock().unwrap();
        match result {
            Err(error) if reported.get(message) != Some(error) => {
                crate::error_report::report_error(app, "RepositoryEngine", message, error);
                reported.insert(message, error.clone());
            }
            Err(_) => {}
            Ok(_) => {
                reported.remove(message);
            }
        }
    }

    async fn set_media_migration(&self, app: Option<&AppHandle>, progress: Option<MediaMigration>) {
        *self.media_migration.lock().unwrap() = progress;
        if let Some(app) = app {
            let _ = app.emit("repository-status", self.status().await);
        }
    }

    // Documents written before media storage keep their bytes until something rewrites them. A sync
    // holds every queued document in memory with its media restored, so this uploads what it has
    // rewritten before rewriting more. That also keeps a device that cannot sync from queueing the
    // whole repository. Taking the store once per document keeps it available in between.
    async fn migrate_media(
        engine: std::sync::Weak<Self>,
        app: Option<AppHandle>,
    ) -> Result<(), String> {
        let result = Self::migrate_media_documents(&engine, app.as_ref()).await;
        if let Some(owner) = engine.upgrade() {
            owner.set_media_migration(app.as_ref(), None).await;
        }
        result
    }

    async fn migrate_media_documents(
        engine: &std::sync::Weak<Self>,
        app: Option<&AppHandle>,
    ) -> Result<(), String> {
        let Some(owner) = engine.upgrade() else {
            return Ok(());
        };
        let candidates = owner
            .with_store(|state| state.documents_large_enough_for_media())
            .await?;
        drop(owner);
        let mut documents = Vec::new();
        for (id, path) in candidates {
            let holds_media = tauri::async_runtime::spawn_blocking(move || {
                std::fs::read(path).is_ok_and(|stored| media::has_inline_media(&stored))
            })
            .await
            .map_err(|error| error.to_string())?;
            if !holds_media {
                continue;
            }
            let Some(owner) = engine.upgrade() else {
                return Ok(());
            };
            // Shown as soon as there is work, before the total is known.
            if documents.is_empty() {
                let progress = MediaMigration {
                    completed: 0,
                    total: 0,
                };
                owner.set_media_migration(app, Some(progress)).await;
            }
            documents.push(id);
        }
        if documents.is_empty() {
            return Ok(());
        }
        let total = documents.len();
        let mut queued = 0;
        for (index, id) in documents.into_iter().enumerate() {
            let Some(owner) = engine.upgrade() else {
                return Ok(());
            };
            let progress = MediaMigration {
                completed: index,
                total,
            };
            owner.set_media_migration(app, Some(progress)).await;
            queued += owner
                .with_store(move |state| state.extract_document_media(&id))
                .await?;
            drop(owner);
            if queued >= MEDIA_BATCH_BYTES {
                Self::wait_for_upload(engine).await?;
                queued = 0;
            }
        }
        if let Some(owner) = engine.upgrade() {
            let progress = MediaMigration {
                completed: total,
                total,
            };
            owner.set_media_migration(app, Some(progress)).await;
        }
        Self::wait_for_upload(engine).await
    }

    // Retries are the scheduler's: it syncs every 30 seconds whatever this is waiting for.
    async fn wait_for_upload(engine: &std::sync::Weak<Self>) -> Result<(), String> {
        let mut woken = false;
        loop {
            let Some(owner) = engine.upgrade() else {
                return Ok(());
            };
            if owner.references.load(Ordering::SeqCst) == 0
                || owner
                    .with_store(|state| Ok(state.outbox.is_empty()))
                    .await?
            {
                return Ok(());
            }
            if !woken {
                owner.wake.notify_one();
                woken = true;
            }
            drop(owner);
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    }

    fn schedule(engine: &Arc<Self>, app: &AppHandle) {
        let weak = Arc::downgrade(engine);
        let app = app.clone();
        let checkpoint_engine = weak.clone();
        let checkpoint_app = app.clone();
        if !engine.checkpoint_scheduling.swap(true, Ordering::SeqCst) {
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    let Some(engine) = checkpoint_engine.upgrade() else {
                        return;
                    };
                    if engine.references.load(Ordering::SeqCst) == 0 {
                        engine.checkpoint_scheduling.store(false, Ordering::SeqCst);
                        if engine.references.load(Ordering::SeqCst) != 0 {
                            Self::schedule(&engine, &checkpoint_app);
                        }
                        return;
                    }
                    let checkpoint = engine.checkpoint_pending().await;
                    engine.report_background_error(
                        &checkpoint_app,
                        "Checkpointing pending documents failed",
                        &checkpoint,
                    );
                    if let Ok(changes) = checkpoint {
                        if !changes.changed.is_empty() {
                            engine.emit_changes(&checkpoint_app, changes).await;
                        }
                    }
                }
            });
        }
        if engine.scheduling.swap(true, Ordering::SeqCst) {
            return;
        }
        tauri::async_runtime::spawn(async move {
            loop {
                let Some(engine) = weak.upgrade() else {
                    return;
                };
                if engine.references.load(Ordering::SeqCst) == 0 {
                    engine.scheduling.store(false, Ordering::SeqCst);
                    if engine.references.load(Ordering::SeqCst) != 0 {
                        Self::schedule(&engine, &app);
                    }
                    return;
                }
                tokio::select! {
                    _ = engine.wake.notified() => { tokio::time::sleep(std::time::Duration::from_secs(1)).await; }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {}
                }
                if engine.references.load(Ordering::SeqCst) != 0 {
                    let result = engine.synchronize(&app, true).await;
                    engine.report_background_error(&app, "Background sync failed", &result);
                }
            }
        });
    }

    async fn operate(&self, operation: RepositoryOperation) -> Result<(Value, Changes), String> {
        match &operation {
            RepositoryOperation::Subscribe {
                node_id,
                session_id,
            } => {
                self.open_notes
                    .lock()
                    .unwrap()
                    .entry(node_id.clone())
                    .or_default()
                    .insert(session_id.clone());
            }
            RepositoryOperation::Unsubscribe {
                node_id,
                session_id,
            } => {
                let mut notes = self.open_notes.lock().unwrap();
                if let Some(sessions) = notes.get_mut(node_id) {
                    sessions.remove(session_id);
                    if sessions.is_empty() {
                        notes.remove(node_id);
                    }
                }
            }
            _ => {}
        }
        self.with_store(move |state| operation.apply(state)).await
    }

    async fn checkpoint_pending(&self) -> Result<Changes, String> {
        self.with_store(|state| {
            let ids = state.delta_counts.keys().cloned().collect::<Vec<_>>();
            let mut changes = Changes::default();
            for id in ids {
                let (_, updated) =
                    RepositoryOperation::CheckpointDocument { node_id: id }.apply(state)?;
                changes.changed.extend(updated.changed);
            }
            Ok(changes)
        })
        .await
    }
}

impl RepositoryOperation {
    fn apply(self, state: &mut Store) -> Result<(Value, Changes), String> {
        let mut changes = Changes::default();
        let result = match self {
            Self::Manifest => {
                json!({"manifest": state.manifest, "revision": state.metadata_revision()})
            }
            Self::SaveMetadata {
                patch,
                revision: expected,
            } => {
                if expected != state.metadata_revision() {
                    return Err("Native metadata conflict".into());
                }
                let mut ids = std::collections::HashSet::new();
                for record in &patch.nodes {
                    let id = record.node.id.as_str();
                    record.node.validate(id)?;
                    if !ids.insert(id) {
                        return Err("Duplicate metadata change".into());
                    }
                }
                for id in &patch.deleted_node_ids {
                    if !crate::repository_bootstrap::valid_component(id) || !ids.insert(id) {
                        return Err("Invalid metadata deletion".into());
                    }
                }
                state.transaction_active = true;
                let mut files = Vec::new();
                for record in patch.nodes {
                    let id = record.node.id.clone();
                    let previous = state.manifest.node(&id);
                    let new_file = record.node.is_file() && previous.is_none();
                    let previous_links = state.manifest.links_by_source.get(&id);
                    if previous != Some(&record.node)
                        || previous_links
                            .map_or(!record.links.is_empty(), |links| *links != record.links)
                    {
                        state.queue("upsert-manifest-node", Some(&id), json!({}));
                        changes.changed.push(id.clone());
                    }
                    let is_plain_canvas = record.node.is_canvas() && record.node.system.is_none();
                    state.manifest.nodes.insert(id.clone(), record.node);
                    if record.links.is_empty() {
                        state.manifest.links_by_source.remove(&id);
                    } else {
                        state
                            .manifest
                            .links_by_source
                            .insert(id.clone(), record.links);
                    }
                    if new_file {
                        let name = file_name(&state.manifest.nodes[&id])?;
                        if !state.root.join("files").join(&name).exists() {
                            files.push(FileWrite {
                                name,
                                bytes: Some(String::new()),
                            });
                        }
                        if is_plain_canvas {
                            let links = document::links(state.doc(&id)?);
                            if !links.is_empty() {
                                state.manifest.links_by_source.insert(id.clone(), links);
                            }
                        }
                        state.queue("push-note", Some(&id), json!({"baseFileRevision":null}));
                    }
                }
                for id in patch.deleted_node_ids {
                    let node = state.manifest.nodes.remove(&id);
                    if let Some(node) = node {
                        state.manifest.remove_links(&id);
                        state.outbox.retain(|op| op["nodeId"] != id);
                        let deleted_files = if node.is_file() {
                            vec![id.clone()]
                        } else {
                            vec![]
                        };
                        state.queue(
                            "delete-manifest-node",
                            Some(&id),
                            json!({"deletedFileIds":deleted_files}),
                        );
                        if node.is_file() {
                            files.push(FileWrite {
                                name: file_name(&node)?,
                                bytes: None,
                            });
                            state.documents.remove(&id);
                        }
                        state.sync.document_generations.remove(&id);
                        changes.deleted.push(id);
                    }
                }
                if let Some(settings) = patch.settings {
                    let mut next = crate::repository_metadata::empty_manifest();
                    next.colors = settings.colors;
                    next.tag_registry = json!(settings.tag_registry);
                    next.pen_presets = Value::Array(settings.pen_presets);
                    next.flag_types = Value::Array(settings.flag_types);
                    crate::repository_metadata::normalize(&mut next);
                    let manifest = &mut state.manifest;
                    let mut queued = Vec::new();
                    for (field, next, kind) in [
                        (&mut manifest.colors, next.colors, "sync-custom-colors"),
                        (
                            &mut manifest.tag_registry,
                            next.tag_registry,
                            "sync-tag-registry",
                        ),
                        (
                            &mut manifest.pen_presets,
                            next.pen_presets,
                            "sync-pen-presets",
                        ),
                        (&mut manifest.flag_types, next.flag_types, "sync-flag-types"),
                    ] {
                        if *field != next {
                            *field = next;
                            queued.push(kind);
                        }
                    }
                    // A client that predates `liveSecret` omits it; that must not erase the secret.
                    if settings.live_secret.is_some()
                        && manifest.live_secret != settings.live_secret
                    {
                        manifest.live_secret = settings.live_secret;
                        queued.push("sync-live-secret");
                    }
                    for kind in queued {
                        state.queue(kind, None, json!({}));
                    }
                }
                state.commit(files)?;
                changes.wake_remote = state.remote;
                json!({"revision":state.metadata_revision()})
            }
            Self::ReadFile { node_id } => {
                let node = state
                    .manifest
                    .node(&node_id)
                    .ok_or("Unknown repository node")?;
                let bytes = state.read_file(node)?;
                json!({"bytesBase64": STANDARD.encode(&bytes), "revision": if bytes.is_empty() { None } else { Some(revision(&bytes)) }})
            }
            Self::Path { node_id } => stored_path(state, &node_id)?,
            Self::Paths { node_ids } => {
                let mut paths = serde_json::Map::new();
                for id in node_ids {
                    let path = stored_path(state, &id)?;
                    if !path.is_null() {
                        paths.insert(id, path);
                    }
                }
                Value::Object(paths)
            }
            Self::WriteFile {
                node,
                bytes_base64,
                replace,
                overwrite_remote,
            } => {
                let bytes = STANDARD
                    .decode(bytes_base64)
                    .map_err(|_| "Invalid repository file bytes")?;
                return write_file(state, node, bytes, replace, overwrite_remote, Vec::new());
            }
            Self::ImportedFile { node, bytes } => {
                return write_file(state, node, bytes, true, false, Vec::new());
            }
            Self::ImportedOneNote {
                notebook,
                parent_id,
                root_name,
                fallback_title,
                progress,
            } => {
                return onenote::import(
                    state,
                    notebook,
                    parent_id,
                    root_name,
                    &fallback_title,
                    &progress,
                );
            }
            Self::ImportFile { .. } | Self::ImportOneNote { .. } => {
                return Err("Import requires an application handle".into())
            }
            Self::RenameReferences {
                source_ids,
                target_id,
                new_name,
                reference_kind,
            } => {
                return references::rename(state, source_ids, target_id, new_name, reference_kind);
            }
            Self::EditFlags { flag_ids, edit } => {
                return flags::edit(state, flag_ids, edit);
            }
            Self::StageBytes { .. } | Self::FinishTransfer { .. } | Self::CancelTransfer { .. } => {
                return Err("Transfer requires a repository handle".into());
            }
            Self::CreateFileVersion { node_id, force } => {
                return version_history::create(state, &node_id, force);
            }
            Self::RestoreFileVersion {
                node_id,
                version_id,
            } => {
                return version_history::restore(state, &node_id, &version_id);
            }
            Self::DeleteFile { node_id, file_type } => {
                let name = match state.manifest.file(&node_id) {
                    Some(node) => file_name(node)?,
                    None => store::file_name_for(
                        &node_id,
                        &file_type.ok_or("Missing repository file type")?,
                    )?,
                };
                state.transaction_active = true;
                state.documents.remove(&node_id);
                state.commit(vec![FileWrite { name, bytes: None }])?;
                Value::Null
            }
            Self::Document {
                node_id,
                state_vector_base64,
            } => {
                let vector = state_vector_base64
                    .map(|vector| {
                        STANDARD
                            .decode(vector)
                            .map_err(|_| "Invalid Yjs state vector")
                    })
                    .transpose()?;
                let (update, vector) = document::diff(state.doc(&node_id)?, vector.as_deref())?;
                let generation = match state.sync.document_generations.get(&node_id) {
                    Some(generation) => generation.clone(),
                    None => {
                        let generation = uuid::Uuid::new_v4().to_string();
                        state
                            .sync
                            .document_generations
                            .insert(node_id.clone(), generation.clone());
                        state.commit(Vec::new())?;
                        generation
                    }
                };
                // Not a content hash: hashing the full encode cost a second whole-document encode
                // per open, even for the state-vector pull whose diff is a few bytes.
                json!({"updateBase64": STANDARD.encode(&update), "stateVectorBase64": STANDARD.encode(&vector), "revision": format!("native:{}", state.data_version), "generation": generation})
            }
            Self::CheckpointDocument { node_id } => {
                if state.delta_counts.contains_key(&node_id) {
                    let bytes = document::bytes(state.doc(&node_id)?);
                    let name = file_name(&state.manifest.nodes[&node_id])?;
                    state.commit(vec![FileWrite {
                        name,
                        bytes: Some(STANDARD.encode(bytes)),
                    }])?;
                    changes.changed.push(node_id);
                }
                Value::Null
            }
            Self::UpdateDocument {
                node_id,
                update_base64,
                origin,
                generation: expected,
                source_session,
            } => {
                if !matches!(origin.as_str(), "local" | "peer") {
                    return Err("Invalid document update origin".into());
                }
                let update = STANDARD
                    .decode(update_base64)
                    .map_err(|_| "Invalid Yjs document update")?;
                state.doc(&node_id)?;
                let had_generation = state.sync.document_generations.contains_key(&node_id);
                let generation = state
                    .sync
                    .document_generations
                    .get(&node_id)
                    .cloned()
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                if expected.is_some_and(|expected| expected != generation) {
                    return Err("Native document replaced".into());
                }
                state.transaction_active = true;
                state
                    .sync
                    .document_generations
                    .insert(node_id.clone(), generation.clone());
                let changed = document::apply(state.doc(&node_id)?, &update)?;
                if changed {
                    changes.wake_remote = state.remote;
                    state.touch_document(&node_id, true)?;
                    state.commit_update(&node_id, &update)?;
                    changes.documents.push(DocumentNotification {
                        node_id: node_id.clone(),
                        bytes: update,
                        source_session,
                        origin,
                        generation: generation.clone(),
                        replacement: false,
                    });
                } else if !had_generation {
                    state.commit(Vec::new())?;
                }
                let vector = document::vector(state.doc(&node_id)?);
                state.transaction_active = false;
                json!({"accepted": true, "changed": changed, "revision": format!("native:{}", state.data_version), "stateVectorBase64": STANDARD.encode(vector), "generation": generation})
            }
            Self::Subscribe { .. } | Self::Unsubscribe { .. } => Value::Null,
        };
        Ok((result, changes))
    }
}

fn write_file(
    state: &mut Store,
    node: Node,
    bytes: Vec<u8>,
    replace: bool,
    overwrite_remote: bool,
    mut files: Vec<FileWrite>,
) -> Result<(Value, Changes), String> {
    let mut changes = Changes::default();
    let id = node.id.clone();
    let name = file_name(&node)?;
    state.transaction_active = true;
    let known = state.manifest.file(&id).is_some();
    changes.wake_remote = known && state.remote;
    let result = if node.is_canvas() {
        let doc = if replace {
            document::decode(&bytes)?
        } else {
            let old = if known {
                document::bytes(state.doc(&id)?)
            } else {
                state.read_file(&node)?
            };
            document::decode(&document::merge(&old, &bytes)?)?
        };
        let bytes = document::bytes(&doc);
        state.documents.insert(id.clone(), doc);
        let generation = if replace || !state.sync.document_generations.contains_key(&id) {
            let generation = uuid::Uuid::new_v4().to_string();
            state
                .sync
                .document_generations
                .insert(id.clone(), generation.clone());
            generation
        } else {
            state.sync.document_generations[&id].clone()
        };
        if known {
            state.touch_document(&id, true)?;
            if overwrite_remote {
                state.queue("push-note", Some(&id), json!({"replaceFile": true}));
            }
        }
        files.push(FileWrite {
            name,
            bytes: Some(STANDARD.encode(&bytes)),
        });
        state.commit(files)?;
        changes.changed.push(id.clone());
        changes.documents.push(DocumentNotification {
            node_id: id.clone(),
            bytes: bytes.clone(),
            source_session: None,
            origin: "local".into(),
            generation,
            replacement: replace && known,
        });
        json!({"revision": revision(&bytes)})
    } else {
        if known {
            let old = state.read_file(&node)?;
            let base = if old.is_empty() {
                None
            } else {
                Some(revision(&old))
            };
            state.manifest.nodes.get_mut(&id).unwrap().modified_at = store::now().into();
            state.queue(
                "push-note",
                Some(&id),
                json!({"baseFileRevision": base, "replaceFile": overwrite_remote}),
            );
            state.queue("upsert-manifest-node", Some(&id), json!({}));
            changes.changed.push(id.clone());
        }
        files.push(FileWrite {
            name,
            bytes: Some(STANDARD.encode(&bytes)),
        });
        state.commit(files)?;
        json!({"revision": revision(&bytes)})
    };
    Ok((result, changes))
}

#[tauri::command]
pub async fn repository_open(
    app: AppHandle,
    manager: tauri::State<'_, RepositoryManager>,
    request: OpenRepositoryRequest,
) -> Result<Value, String> {
    let id = if request.storage_root.is_empty() {
        "local".to_owned()
    } else {
        request.storage_root.clone()
    };
    let mut engines = manager.engines.lock().await;
    let engine = if let Some(engine) = engines.get(&id) {
        engine.clone()
    } else {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let root = request.storage_root.clone();
        let remote = request.source.is_some();
        if remote != !root.is_empty() {
            return Err("Invalid native repository configuration".into());
        }
        let store = tauri::async_runtime::spawn_blocking(move || {
            let path = if root.is_empty() {
                app_data
            } else {
                CachePaths::new(&app_data, &root)?.cache
            };
            Store::open(path, remote)
        })
        .await
        .map_err(|error| error.to_string())??;
        let engine = Arc::new(RepositoryEngine {
            id: id.clone(),
            store: Arc::new(Mutex::new(store)),
            source: AsyncMutex::new(request.source.clone()),
            credential_id: Mutex::new(request.credential_id.clone()),
            network_lock: AsyncMutex::new(()),
            open_notes: Arc::new(Mutex::new(HashMap::new())),
            references: AtomicUsize::new(0),
            scheduling: AtomicBool::new(false),
            checkpoint_scheduling: AtomicBool::new(false),
            wake: Notify::new(),
            online: AtomicBool::new(true),
            syncing: AtomicBool::new(false),
            last_checked_at: AtomicU64::new(0),
            error: Mutex::new(None),
            media_migration: Mutex::new(None),
            reported_errors: Mutex::new(HashMap::new()),
            cache_dir: app
                .path()
                .app_cache_dir()
                .map_err(|error| error.to_string())?,
        });
        let _ = engine.clean_bases().await;
        engines.insert(id, engine.clone());
        engine
    };
    let first_handle = engine.references.fetch_add(1, Ordering::SeqCst) == 0;
    drop(engines);
    let handle_id = uuid::Uuid::new_v4().to_string();
    manager.handles.lock().await.insert(
        handle_id.clone(),
        RepositoryHandle {
            engine: engine.clone(),
            notes: HashMap::new(),
            transfers: HashMap::new(),
        },
    );
    if request.source.is_some() {
        *engine.credential_id.lock().unwrap() = request.credential_id;
        *engine.source.lock().await = request.source;
    }
    let has_local_state = engine
        .with_store(|state| {
            Ok(!state.manifest.nodes.is_empty()
                || !state.outbox.is_empty()
                || state.sync.last_remote_sync_at.is_some())
        })
        .await?;
    if !has_local_state {
        let result = engine.synchronize(&app, false).await;
        engine.report_background_error(&app, "Background sync failed", &result);
    }
    RepositoryEngine::schedule(&engine, &app);
    if has_local_state {
        engine.wake.notify_one();
    }
    if first_handle {
        let weak = Arc::downgrade(&engine);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = RepositoryEngine::migrate_media(weak, Some(app.clone())).await {
                crate::error_report::report_error(
                    &app,
                    "RepositoryEngine",
                    "Media migration failed",
                    error,
                );
            }
        });
    }
    Ok(json!({"handle": handle_id, "status": engine.status().await}))
}

#[tauri::command]
pub async fn repository_operation(
    app: AppHandle,
    webview: tauri::Webview,
    manager: tauri::State<'_, RepositoryManager>,
    handle: String,
    operation: RepositoryOperation,
) -> Result<Value, String> {
    let engine = manager.engine(&handle).await?;
    match &operation {
        RepositoryOperation::Subscribe {
            node_id,
            session_id,
        } => {
            let mut handles = manager.handles.lock().await;
            let handle = handles
                .get_mut(&handle)
                .ok_or("Repository handle is closed")?;
            handle
                .notes
                .entry(node_id.clone())
                .or_default()
                .insert(session_id.clone());
            drop(handles);
            return engine.operate(operation).await.map(|(result, _)| result);
        }
        RepositoryOperation::Unsubscribe {
            node_id,
            session_id,
        } => {
            let mut handles = manager.handles.lock().await;
            let mut removed = false;
            if let Some(handle) = handles.get_mut(&handle) {
                if let Some(sessions) = handle.notes.get_mut(node_id) {
                    removed = sessions.remove(session_id);
                    if sessions.is_empty() {
                        handle.notes.remove(node_id);
                    }
                }
            }
            drop(handles);
            return if removed {
                engine.operate(operation).await.map(|(result, _)| result)
            } else {
                Ok(Value::Null)
            };
        }
        _ => {}
    }
    let operation = {
        let mut handles = manager.handles.lock().await;
        handles
            .get_mut(&handle)
            .ok_or("Repository handle is closed")?
            .resolve_transfer(operation)?
    };
    let Some(operation) = operation else {
        return Ok(Value::Null);
    };
    let operation = match operation {
        RepositoryOperation::ImportOneNote {
            path,
            parent_id,
            root_name,
            fallback_title,
            progress,
        } => {
            let app = app.clone();
            let notebook = tokio::task::spawn_blocking(move || {
                crate::onenote_import::read_notebook(&app, path)
            })
            .await
            .map_err(|error| error.to_string())??;
            RepositoryOperation::ImportedOneNote {
                notebook,
                parent_id,
                root_name,
                fallback_title,
                progress: progress.channel_on(webview),
            }
        }
        RepositoryOperation::ImportFile { node, source } => {
            let app = app.clone();
            let bytes = tokio::task::spawn_blocking(move || source.read(&app))
                .await
                .map_err(|error| error.to_string())??;
            RepositoryOperation::ImportedFile { node, bytes }
        }
        operation => operation,
    };
    let (result, changes) = engine.operate(operation).await?;
    engine.emit_changes(&app, changes).await;
    Ok(result)
}

#[tauri::command]
pub async fn repository_sync(
    app: AppHandle,
    manager: tauri::State<'_, RepositoryManager>,
    handle: String,
) -> Result<(), String> {
    manager.engine(&handle).await?.synchronize(&app, true).await
}

#[tauri::command]
pub async fn repository_release(
    app: AppHandle,
    manager: tauri::State<'_, RepositoryManager>,
    handle: String,
) -> Result<(), String> {
    let removed = manager.handles.lock().await.remove(&handle);
    if let Some(handle) = removed {
        {
            let mut notes = handle.engine.open_notes.lock().unwrap();
            for (id, removed) in handle.notes {
                if let Some(sessions) = notes.get_mut(&id) {
                    sessions.retain(|session| !removed.contains(session));
                    if sessions.is_empty() {
                        notes.remove(&id);
                    }
                }
            }
        }
        handle.engine.references.fetch_sub(1, Ordering::SeqCst);
        handle.engine.wake.notify_one();
        let checkpoint = handle.engine.checkpoint_pending().await;
        if let Ok(changes) = checkpoint.as_ref() {
            let _ = app.emit("repository-status", handle.engine.status().await);
            let _ = app.emit("repository-data", json!({"repositoryId": handle.engine.id, "changed": changes.changed, "deleted": changes.deleted}));
        }
        let _network = handle.engine.network_lock.lock().await;
        let mut engines = manager.engines.lock().await;
        if handle.engine.references.load(Ordering::SeqCst) == 0 {
            engines.remove(&handle.engine.id);
        }
        checkpoint?;
    }
    Ok(())
}

#[tauri::command]
pub async fn repository_auth_response(
    manager: tauri::State<'_, RepositoryManager>,
    request_id: String,
    token: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    if let Some(sender) = manager.auth.lock().await.remove(&request_id) {
        let _ = sender.send(
            token.ok_or_else(|| error.unwrap_or_else(|| "Repository authentication failed".into())),
        );
    }
    Ok(())
}

pub(crate) async fn peer_update(
    app: &AppHandle,
    handle: &str,
    node_id: &str,
    update: Vec<u8>,
) -> Result<(), String> {
    let manager = app.state::<RepositoryManager>();
    let engine = manager.engine(handle).await?;
    let (_, changes) = engine
        .operate(RepositoryOperation::UpdateDocument {
            node_id: node_id.into(),
            update_base64: STANDARD.encode(update),
            origin: "peer".into(),
            generation: None,
            source_session: None,
        })
        .await?;
    engine.emit_changes(app, changes).await;
    Ok(())
}

pub(crate) async fn initial_peer_state(
    app: &AppHandle,
    handle: &str,
    node_id: &str,
) -> Result<Vec<u8>, String> {
    let manager = app.state::<RepositoryManager>();
    let engine = manager.engine(handle).await?;
    let node = node_id.to_owned();
    engine
        .with_store(move |state| Ok(document::bytes(state.doc(&node)?)))
        .await
}

pub(crate) async fn repository_identity(app: &AppHandle, handle: &str) -> Result<String, String> {
    Ok(app
        .state::<RepositoryManager>()
        .engine(handle)
        .await?
        .id
        .clone())
}
