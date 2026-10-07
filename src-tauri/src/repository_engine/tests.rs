use super::*;
use crate::repository_bootstrap::download::RemoteEndpoints;
use std::{fs, sync::atomic::AtomicU64};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use yrs::{Any, Array, GetString, Map, Out, ReadTxn, Text, Transact};

struct TestDirectory(PathBuf);
impl TestDirectory {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "myelin-native-engine-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn engine(&self, remote: bool) -> Arc<RepositoryEngine> {
        Arc::new(RepositoryEngine {
            id: "test-repository".into(),
            store: Arc::new(Mutex::new(
                Store::open(self.0.join("data"), remote).unwrap(),
            )),
            source: AsyncMutex::new(None),
            credential_id: Mutex::new("test".into()),
            network_lock: AsyncMutex::new(()),
            open_notes: Arc::new(Mutex::new(HashMap::new())),
            references: AtomicUsize::new(1),
            scheduling: AtomicBool::new(false),
            checkpoint_scheduling: AtomicBool::new(false),
            wake: Notify::new(),
            online: AtomicBool::new(true),
            error: Mutex::new(None),
            cache_dir: self.0.join("cache"),
        })
    }
}
impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/yjs-document.json")).unwrap()
}
fn fixture_bytes(key: &str) -> Vec<u8> {
    STANDARD.decode(fixture()[key].as_str().unwrap()).unwrap()
}
fn node(id: &str, kind: &str) -> Value {
    json!({"id": id, "type": "file", "fileType": kind, "name": format!("{id}.{kind}"), "parentId": null, "tags": [], "createdAt": 1, "modifiedAt": 1})
}

fn metadata_patch(previous: &Value, next: &Value) -> MetadataPatch {
    serde_json::from_value(json!({
        "nodes":next["nodes"].as_object().unwrap().iter().filter(|(id,node)| previous["nodes"][*id] != **node || previous["linksBySource"][*id] != next["linksBySource"][*id])
            .map(|(id,node)|json!({"node":node,"links":next["linksBySource"][id].as_array().cloned().unwrap_or_default()})).collect::<Vec<_>>(),
        "deletedNodeIds":previous["nodes"].as_object().unwrap().keys().filter(|id|next["nodes"][*id].is_null()).collect::<Vec<_>>(),
        "settings":{"colors":next["colors"],"tagRegistry":next["tagRegistry"],"penPresets":next["penPresets"]}
    })).unwrap()
}

async fn save_manifest(engine: &RepositoryEngine, manifest: Value) {
    let (saved, _) = engine.operate(RepositoryOperation::Manifest).await.unwrap();
    engine
        .operate(RepositoryOperation::SaveMetadata {
            patch: metadata_patch(&saved["manifest"], &manifest),
            revision: saved["revision"].as_str().unwrap().into(),
        })
        .await
        .unwrap();
}
async fn seed(engine: &RepositoryEngine, id: &str, kind: &str, bytes: Vec<u8>) {
    let (saved, _) = engine.operate(RepositoryOperation::Manifest).await.unwrap();
    let mut manifest = saved["manifest"].clone();
    let file = node(id, kind);
    manifest["nodes"][id] = file.clone();
    save_manifest(engine, manifest).await;
    engine
        .operate(RepositoryOperation::WriteFile {
            node: file,
            bytes_base64: STANDARD.encode(bytes),
            replace: true,
            overwrite_remote: false,
        })
        .await
        .unwrap();
}
async fn update(engine: &RepositoryEngine, key: &str, origin: &str) -> (Value, Changes) {
    engine
        .operate(RepositoryOperation::UpdateDocument {
            node_id: "canvas".into(),
            update_base64: fixture()[key].as_str().unwrap().into(),
            origin: origin.into(),
            generation: None,
            source_session: None,
        })
        .await
        .unwrap()
}
async fn read(engine: &RepositoryEngine, id: &str) -> Vec<u8> {
    let (saved, _) = engine
        .operate(RepositoryOperation::ReadFile { node_id: id.into() })
        .await
        .unwrap();
    STANDARD
        .decode(saved["bytesBase64"].as_str().unwrap())
        .unwrap()
}
fn assert_document(bytes: &[u8]) {
    let expected = fixture()["expected"].clone();
    let doc = document::decode(bytes).unwrap();
    let txn = doc.transact();
    assert_eq!(
        txn.get_text("content").unwrap().get_string(&txn),
        expected["content"].as_str().unwrap()
    );
    let elements = txn.get_array("elements").unwrap();
    let mut ids = Vec::new();
    for element in elements.iter(&txn) {
        let Out::YMap(element) = element else {
            panic!("element map")
        };
        let Some(Out::Any(Any::String(id))) = element.get(&txn, "uuid") else {
            panic!("element ID")
        };
        ids.push(id.to_string());
        if id.as_ref() == "pdf-1" {
            let Some(Out::Any(Any::Buffer(bytes))) = element.get(&txn, "pdfData") else {
                panic!("PDF binary")
            };
            assert_eq!(
                bytes.len(),
                expected["pdfByteLength"].as_u64().unwrap() as usize
            );
            assert_eq!(
                store::revision(&bytes),
                expected["pdfSha256"].as_str().unwrap()
            );
        }
    }
    assert_eq!(json!(ids), expected["elementIds"]);
    drop(txn);
    assert_eq!(json!(document::links(&doc)), expected["links"]);
}

async fn capture_version(engine: &RepositoryEngine, id: &str, force: bool) -> Value {
    engine
        .operate(RepositoryOperation::CreateFileVersion {
            node_id: id.into(),
            force,
        })
        .await
        .unwrap()
        .0
}

#[tokio::test]
async fn native_versions_check_cadence_before_reading_and_deduplicate_existing_content() {
    let directory = TestDirectory::new();
    let engine = directory.engine(false);
    seed(&engine, "picture", "png", b"original".to_vec()).await;
    let version = capture_version(&engine, "picture", false).await;
    assert_eq!(version["byteLength"], 8);
    assert_eq!(
        read(&engine, version["id"].as_str().unwrap()).await,
        b"original"
    );
    assert!(version.get("bytesBase64").is_none());
    let source = directory.0.join("data/files/picture.png");
    fs::remove_file(&source).unwrap();
    fs::create_dir(&source).unwrap();
    assert!(capture_version(&engine, "picture", false).await.is_null());
    assert!(engine
        .operate(RepositoryOperation::CreateFileVersion {
            node_id: "picture".into(),
            force: true,
        })
        .await
        .is_err());
    fs::remove_dir(&source).unwrap();
    fs::write(&source, b"changed").unwrap();
    {
        let mut store = engine.store.lock().unwrap();
        store.manifest["nodes"][version["id"].as_str().unwrap()]["system"]["capturedAt"] = json!(1);
    }
    let changed = capture_version(&engine, "picture", false).await;
    assert_eq!(
        read(&engine, changed["id"].as_str().unwrap()).await,
        b"changed"
    );
    assert!(capture_version(&engine, "picture", true).await.is_null());
    assert!(
        capture_version(&engine, version["id"].as_str().unwrap(), true)
            .await
            .is_null()
    );
    assert!(capture_version(&engine, "missing", true).await.is_null());
}

#[tokio::test]
async fn native_restore_preserves_metadata_saves_current_bytes_and_rejects_missing_versions() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "picture", "png", b"original".to_vec()).await;
    let version = capture_version(&engine, "picture", false).await;
    let version_id = version["id"].as_str().unwrap();
    engine
        .operate(RepositoryOperation::WriteFile {
            node: node("picture", "png"),
            bytes_base64: STANDARD.encode(b"current"),
            replace: true,
            overwrite_remote: false,
        })
        .await
        .unwrap();
    let before = {
        let mut store = engine.store.lock().unwrap();
        store.manifest["nodes"]["picture"]["name"] = json!("Renamed.png");
        store.manifest["nodes"]["picture"]["tags"] = json!(["keep"]);
        store.manifest["nodes"]["picture"].clone()
    };
    assert!(engine
        .operate(RepositoryOperation::RestoreFileVersion {
            node_id: "other".into(),
            version_id: version_id.into(),
        })
        .await
        .is_err());
    let before_version = engine.store.lock().unwrap().data_version;
    engine
        .operate(RepositoryOperation::RestoreFileVersion {
            node_id: "picture".into(),
            version_id: version_id.into(),
        })
        .await
        .unwrap();
    let backup_id = {
        let store = engine.store.lock().unwrap();
        assert_eq!(store.data_version, before_version + 1);
        for key in ["name", "parentId", "tags", "createdAt"] {
            assert_eq!(store.manifest["nodes"]["picture"][key], before[key]);
        }
        assert!(store
            .outbox
            .iter()
            .any(|op| op["nodeId"] == "picture" && op["replaceFile"] == true));
        store.manifest["nodes"]
            .as_object()
            .unwrap()
            .values()
            .find(|node| node["system"]["kind"] == "file-version" && node["id"] != version_id)
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    assert_eq!(read(&engine, "picture").await, b"original");
    assert_eq!(read(&engine, &backup_id).await, b"current");
    let before_noop = engine.store.lock().unwrap().data_version;
    let (_, changes) = engine
        .operate(RepositoryOperation::RestoreFileVersion {
            node_id: "picture".into(),
            version_id: version_id.into(),
        })
        .await
        .unwrap();
    assert!(changes.changed.is_empty());
    assert_eq!(engine.store.lock().unwrap().data_version, before_noop);
    drop(engine);
    let engine = directory.engine(true);
    engine
        .operate(RepositoryOperation::RestoreFileVersion {
            node_id: "picture".into(),
            version_id: backup_id.clone(),
        })
        .await
        .unwrap();
    assert_eq!(read(&engine, "picture").await, b"current");
    assert_eq!(
        engine.store.lock().unwrap().manifest["nodes"]
            .as_object()
            .unwrap()
            .values()
            .filter(|node| node["system"]["kind"] == "file-version")
            .count(),
        2
    );
    fs::remove_file(directory.0.join(format!("data/files/{version_id}.png"))).unwrap();
    assert_eq!(
        engine
            .operate(RepositoryOperation::RestoreFileVersion {
                node_id: "picture".into(),
                version_id: version_id.into(),
            })
            .await
            .err()
            .unwrap(),
        "Version data is missing."
    );
    assert_eq!(read(&engine, "picture").await, b"current");
}

#[tokio::test]
async fn native_restore_can_prune_the_selected_version_without_losing_its_bytes() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "picture", "png", vec![0]).await;
    let mut oldest_id = String::new();
    for index in 0..32 {
        engine
            .operate(RepositoryOperation::WriteFile {
                node: node("picture", "png"),
                bytes_base64: STANDARD.encode([index]),
                replace: true,
                overwrite_remote: false,
            })
            .await
            .unwrap();
        let version = capture_version(&engine, "picture", true).await;
        let id = version["id"].as_str().unwrap();
        if index == 0 {
            oldest_id = id.into();
        }
        engine.store.lock().unwrap().manifest["nodes"][id]["system"]["capturedAt"] =
            json!(index + 1);
    }
    engine
        .operate(RepositoryOperation::WriteFile {
            node: node("picture", "png"),
            bytes_base64: STANDARD.encode([99]),
            replace: true,
            overwrite_remote: false,
        })
        .await
        .unwrap();
    let (_, changes) = engine
        .operate(RepositoryOperation::RestoreFileVersion {
            node_id: "picture".into(),
            version_id: oldest_id.clone(),
        })
        .await
        .unwrap();
    assert_eq!(read(&engine, "picture").await, vec![0]);
    assert_eq!(changes.deleted, vec![oldest_id.clone()]);
    assert!(!directory
        .0
        .join(format!("data/files/{oldest_id}.png"))
        .exists());
    let backup_id = {
        let store = engine.store.lock().unwrap();
        let versions = store.manifest["nodes"]
            .as_object()
            .unwrap()
            .values()
            .filter(|node| node["system"]["kind"] == "file-version")
            .collect::<Vec<_>>();
        assert_eq!(versions.len(), 32);
        assert!(store
            .outbox
            .iter()
            .any(|op| op["kind"] == "delete-manifest-node" && op["nodeId"] == oldest_id));
        versions
            .into_iter()
            .max_by_key(|node| node["system"]["capturedAt"].as_u64().unwrap())
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    assert_eq!(read(&engine, &backup_id).await, vec![99]);
}

#[tokio::test]
async fn native_canvas_restore_captures_uncheckpointed_edits_and_replaces_the_generation() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "canvas", "mcanvas", fixture_bytes("baseUpdate")).await;
    let version = capture_version(&engine, "canvas", false).await;
    let version_id = version["id"].as_str().unwrap();
    let (opened, _) = engine
        .operate(RepositoryOperation::Document {
            node_id: "canvas".into(),
            state_vector_base64: None,
        })
        .await
        .unwrap();
    update(&engine, "localUpdate", "local").await;
    update(&engine, "remoteUpdate", "peer").await;
    update(&engine, "deletionUpdate", "local").await;
    let (_, changes) = engine
        .operate(RepositoryOperation::RestoreFileVersion {
            node_id: "canvas".into(),
            version_id: version_id.into(),
        })
        .await
        .unwrap();
    assert!(changes.documents[0].replacement);
    assert_ne!(
        changes.documents[0].generation,
        opened["generation"].as_str().unwrap()
    );
    let backup_id = {
        let store = engine.store.lock().unwrap();
        let backup = store.manifest["nodes"]
            .as_object()
            .unwrap()
            .values()
            .find(|node| node["system"]["kind"] == "file-version" && node["id"] != version_id)
            .unwrap();
        assert!(store.manifest["linksBySource"][backup["id"].as_str().unwrap()].is_null());
        assert!(store
            .outbox
            .iter()
            .any(|op| op["nodeId"] == "canvas" && op["replaceFile"] == true));
        assert_eq!(
            store.manifest["linksBySource"]["canvas"],
            json!(document::links(
                &document::decode(&fixture_bytes("baseUpdate")).unwrap()
            ))
        );
        backup["id"].as_str().unwrap().to_owned()
    };
    assert_document(&read(&engine, &backup_id).await);
    assert!(!directory.0.join("data/.native-updates/canvas").exists());
    assert!(engine
        .operate(RepositoryOperation::UpdateDocument {
            node_id: "canvas".into(),
            update_base64: fixture()["localUpdate"].as_str().unwrap().into(),
            origin: "local".into(),
            generation: Some(opened["generation"].as_str().unwrap().into()),
            source_session: None,
        })
        .await
        .is_err());
    drop(engine);
    let reopened = directory.engine(true);
    assert_document(&read(&reopened, &backup_id).await);
    let restored = read(&reopened, "canvas").await;
    let saved = read(&reopened, version_id).await;
    assert!(!document::apply(&document::decode(&restored).unwrap(), &saved).unwrap());
    assert!(!document::apply(&document::decode(&saved).unwrap(), &restored).unwrap());
}

#[tokio::test]
async fn real_yjs_deltas_persist_peer_edits_and_deletions_without_full_binary_rewrites() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "canvas", "mcanvas", fixture_bytes("baseUpdate")).await;
    let original_file = fs::read(directory.0.join("data/files/canvas.myelin")).unwrap();
    update(&engine, "localUpdate", "local").await;
    let (peer, changes) = update(&engine, "remoteUpdate", "peer").await;
    assert!(peer["changed"].as_bool().unwrap());
    assert!(peer.get("updateBase64").is_none());
    assert_eq!(changes.documents[0].origin, "peer");
    assert!(changes.wake_remote);
    let before_delete = peer["stateVectorBase64"].clone();
    let (deleted, _) = update(&engine, "deletionUpdate", "local").await;
    assert_eq!(deleted["stateVectorBase64"], before_delete);
    assert_eq!(deleted["changed"], true);
    assert_eq!(
        fs::read(directory.0.join("data/files/canvas.myelin")).unwrap(),
        original_file
    );
    assert_document(&read(&engine, "canvas").await);
    let repeated = update(&engine, "deletionUpdate", "peer").await;
    assert_eq!(repeated.0["changed"], false);
    assert!(repeated.1.documents.is_empty());
    assert!(!repeated.1.wake_remote);
    drop(engine);
    let reopened = directory.engine(true);
    assert_document(&read(&reopened, "canvas").await);
    assert_document(&fs::read(directory.0.join("data/files/canvas.myelin")).unwrap());
    assert!(!directory.0.join("data/.native-updates/canvas").exists());
    assert_eq!(
        reopened
            .store
            .lock()
            .unwrap()
            .outbox
            .iter()
            .filter(|op| op["kind"] == "push-note")
            .count(),
        1
    );
}

#[tokio::test]
async fn closed_canvas_documents_are_released_after_their_last_session_and_checkpoint() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "canvas", "mcanvas", fixture_bytes("baseUpdate")).await;
    let open = || RepositoryOperation::Document {
        node_id: "canvas".into(),
        state_vector_base64: None,
    };
    engine.operate(open()).await.unwrap();
    assert!(engine.store.lock().unwrap().documents.is_empty());
    for session in ["editor", "second-editor"] {
        engine
            .operate(RepositoryOperation::Subscribe {
                node_id: "canvas".into(),
                session_id: session.into(),
            })
            .await
            .unwrap();
    }
    engine.operate(open()).await.unwrap();
    update(&engine, "localUpdate", "local").await;
    update(&engine, "remoteUpdate", "peer").await;
    engine
        .operate(RepositoryOperation::Unsubscribe {
            node_id: "canvas".into(),
            session_id: "editor".into(),
        })
        .await
        .unwrap();
    engine.checkpoint_pending().await.unwrap();
    assert!(engine
        .store
        .lock()
        .unwrap()
        .documents
        .contains_key("canvas"));
    engine
        .operate(RepositoryOperation::Unsubscribe {
            node_id: "canvas".into(),
            session_id: "second-editor".into(),
        })
        .await
        .unwrap();
    assert!(engine.store.lock().unwrap().documents.is_empty());
    engine
        .operate(RepositoryOperation::Subscribe {
            node_id: "canvas".into(),
            session_id: "editor".into(),
        })
        .await
        .unwrap();
    engine.operate(open()).await.unwrap();
    update(&engine, "deletionUpdate", "local").await;
    engine
        .operate(RepositoryOperation::Unsubscribe {
            node_id: "canvas".into(),
            session_id: "editor".into(),
        })
        .await
        .unwrap();
    assert!(engine
        .store
        .lock()
        .unwrap()
        .documents
        .contains_key("canvas"));
    engine.checkpoint_pending().await.unwrap();
    assert!(engine.store.lock().unwrap().documents.is_empty());
    assert_document(&read(&engine, "canvas").await);
    assert_document(&read(&directory.engine(true), "canvas").await);
}

#[tokio::test]
async fn document_events_skip_the_source_session_and_replacements_omit_bytes() {
    let directory = TestDirectory::new();
    let engine = directory.engine(false);
    seed(&engine, "canvas", "mcanvas", fixture_bytes("baseUpdate")).await;
    engine
        .open_notes
        .lock()
        .unwrap()
        .insert("canvas".into(), HashSet::from(["editor".into()]));
    let (_, changes) = engine
        .operate(RepositoryOperation::UpdateDocument {
            node_id: "canvas".into(),
            update_base64: fixture()["localUpdate"].as_str().unwrap().into(),
            origin: "local".into(),
            generation: None,
            source_session: Some("editor".into()),
        })
        .await
        .unwrap();
    let notification = &changes.documents[0];
    let mut events = Vec::new();
    engine.emit_document_change(notification, |event, payload| {
        events.push((event.to_owned(), serde_json::to_value(payload).unwrap()));
    });
    assert!(events.is_empty());
    engine
        .open_notes
        .lock()
        .unwrap()
        .get_mut("canvas")
        .unwrap()
        .insert("mcp".into());
    engine.emit_document_change(notification, |event, payload| {
        events.push((event.to_owned(), serde_json::to_value(payload).unwrap()));
    });
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, "repository-document-mcp");
    assert_eq!(events[0].1["updateBase64"], fixture()["localUpdate"]);
    assert_eq!(events[0].1["origin"], "local");
    let (_, peer) = update(&engine, "remoteUpdate", "peer").await;
    events.clear();
    engine.emit_document_change(&peer.documents[0], |event, payload| {
        events.push((event.to_owned(), serde_json::to_value(payload).unwrap()));
    });
    assert_eq!(events.len(), 2);
    assert!(events
        .iter()
        .any(|(event, _)| event == "repository-document-editor"));
    assert!(events
        .iter()
        .all(|(_, payload)| payload["origin"] == "peer"));
    let (_, replacement) = engine
        .operate(RepositoryOperation::WriteFile {
            node: node("canvas", "mcanvas"),
            bytes_base64: fixture()["baseUpdate"].as_str().unwrap().into(),
            replace: true,
            overwrite_remote: true,
        })
        .await
        .unwrap();
    events.clear();
    engine.emit_document_change(&replacement.documents[0], |event, payload| {
        events.push((event.to_owned(), serde_json::to_value(payload).unwrap()));
    });
    assert_eq!(events.len(), 2);
    for (_, payload) in events {
        assert_eq!(payload["replacement"], true);
        assert_eq!(payload["generation"], replacement.documents[0].generation);
        assert!(payload.get("updateBase64").is_none());
    }
    assert!(replacement.documents[0].bytes.len() > 65536);
}

#[tokio::test]
async fn checkpoint_materializes_index_bytes_and_imported_links_and_rejects_stale_generation() {
    let directory = TestDirectory::new();
    let engine = directory.engine(false);
    let links: Value = serde_json::from_str(include_str!("fixtures/yjs-links.json")).unwrap();
    let file = node("canvas", "mcanvas");
    let (before_import, _) = engine.operate(RepositoryOperation::Manifest).await.unwrap();
    engine
        .operate(RepositoryOperation::WriteFile {
            node: file.clone(),
            bytes_base64: links["update"].as_str().unwrap().into(),
            replace: true,
            overwrite_remote: false,
        })
        .await
        .unwrap();
    let mut manifest = crate::repository_metadata::empty_manifest();
    manifest["nodes"]["canvas"] = file.clone();
    engine
        .operate(RepositoryOperation::SaveMetadata {
            patch: metadata_patch(&before_import["manifest"], &manifest),
            revision: before_import["revision"].as_str().unwrap().into(),
        })
        .await
        .unwrap();
    let (saved, _) = engine.operate(RepositoryOperation::Manifest).await.unwrap();
    assert_eq!(
        saved["manifest"]["linksBySource"]["canvas"],
        links["expected"]
    );
    assert!(engine.store.lock().unwrap().outbox.is_empty());
    engine
        .operate(RepositoryOperation::WriteFile {
            node: file.clone(),
            bytes_base64: fixture()["baseUpdate"].as_str().unwrap().into(),
            replace: true,
            overwrite_remote: false,
        })
        .await
        .unwrap();
    let (opened, _) = engine
        .operate(RepositoryOperation::Document {
            node_id: "canvas".into(),
            state_vector_base64: None,
        })
        .await
        .unwrap();
    update(&engine, "localUpdate", "local").await;
    update(&engine, "remoteUpdate", "peer").await;
    update(&engine, "deletionUpdate", "peer").await;
    let checkpoint = engine.checkpoint_pending().await.unwrap();
    assert_eq!(checkpoint.changed, vec!["canvas"]);
    assert!(!checkpoint.wake_remote);
    assert_document(&fs::read(directory.0.join("data/files/canvas.myelin")).unwrap());
    let (_, replacement) = engine
        .operate(RepositoryOperation::WriteFile {
            node: file,
            bytes_base64: fixture()["baseUpdate"].as_str().unwrap().into(),
            replace: true,
            overwrite_remote: true,
        })
        .await
        .unwrap();
    assert!(replacement.documents[0].replacement);
    assert_ne!(
        replacement.documents[0].generation,
        opened["generation"].as_str().unwrap()
    );
    let stale = engine
        .operate(RepositoryOperation::UpdateDocument {
            node_id: "canvas".into(),
            update_base64: fixture()["localUpdate"].as_str().unwrap().into(),
            origin: "local".into(),
            generation: Some(opened["generation"].as_str().unwrap().into()),
            source_session: None,
        })
        .await;
    assert_eq!(stale.err().unwrap(), "Native document replaced");
    let doc = document::decode(&read(&engine, "canvas").await).unwrap();
    assert_eq!(
        doc.transact()
            .get_text("content")
            .unwrap()
            .get_string(&doc.transact()),
        "seed"
    );
}

#[tokio::test]
async fn failed_durability_blocks_more_writes_then_replays_the_delta_on_reopen() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "canvas", "mcanvas", fixture_bytes("baseUpdate")).await;
    let temporary = directory.0.join("data/.outbox.json.native.tmp");
    fs::create_dir(&temporary).unwrap();
    let failed = engine
        .operate(RepositoryOperation::UpdateDocument {
            node_id: "canvas".into(),
            update_base64: fixture()["localUpdate"].as_str().unwrap().into(),
            origin: "local".into(),
            generation: None,
            source_session: None,
        })
        .await;
    assert!(failed.is_err());
    assert!(directory.0.join("data/.native-journal.json").exists());
    assert!(engine
        .operate(RepositoryOperation::Manifest)
        .await
        .err()
        .unwrap()
        .contains("durability requires recovery"));
    fs::remove_dir(temporary).unwrap();
    drop(engine);
    let reopened = directory.engine(true);
    update(&reopened, "remoteUpdate", "peer").await;
    update(&reopened, "deletionUpdate", "peer").await;
    assert_document(&read(&reopened, "canvas").await);
    assert!(!directory.0.join("data/.native-journal.json").exists());
    let version = reopened.status().await.data_version;
    assert!(reopened
        .operate(RepositoryOperation::SaveMetadata {
            patch: MetadataPatch::default(),
            revision: "stale".into()
        })
        .await
        .is_err());
    assert_eq!(reopened.status().await.data_version, version);
}

#[tokio::test]
async fn corrupt_outbox_is_quarantined_and_pauses_cloud_without_losing_local_files() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "canvas", "mcanvas", fixture_bytes("baseUpdate")).await;
    fs::write(
        directory.0.join("data/outbox.json"),
        b"corrupt pending operations",
    )
    .unwrap();
    drop(engine);
    let reopened = directory.engine(true);
    assert!(reopened
        .status()
        .await
        .last_error
        .unwrap()
        .contains("requires recovery"));
    assert!(!reopened.status().await.online);
    update(&reopened, "localUpdate", "local").await;
    assert!(reopened.store.lock().unwrap().manifest["nodes"]["canvas"].is_object());
    assert!(fs::read_dir(directory.0.join("data"))
        .unwrap()
        .any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("outbox.corrupt.")));
}

#[derive(Clone)]
struct Request {
    method: String,
    path: String,
    body: Vec<u8>,
}
struct TestServer {
    endpoints: RemoteEndpoints,
    requests: Arc<Mutex<Vec<Request>>>,
    task: tokio::task::JoinHandle<()>,
    pause_blob: Arc<AtomicBool>,
    paused: Arc<Notify>,
    resume: Arc<Notify>,
}
impl TestServer {
    async fn new(handler: impl Fn(&Request) -> (u16, Vec<u8>) + Send + Sync + 'static) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        let pause_blob = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(Notify::new());
        let resume = Arc::new(Notify::new());
        let gate = pause_blob.clone();
        let entered = paused.clone();
        let released = resume.clone();
        let task = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 8192];
                let header_end = loop {
                    let count = socket.read(&mut buffer).await.unwrap();
                    if count == 0 {
                        panic!("incomplete fixture request");
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                    if let Some(index) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        break index + 4;
                    }
                };
                let headers = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (key, value) = line.split_once(':')?;
                        key.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                while bytes.len() < header_end + length {
                    let count = socket.read(&mut buffer).await.unwrap();
                    bytes.extend_from_slice(&buffer[..count]);
                }
                let mut parts = headers.lines().next().unwrap().split_whitespace();
                let request = Request {
                    method: parts.next().unwrap().into(),
                    path: parts.next().unwrap().into(),
                    body: bytes[header_end..].to_vec(),
                };
                recorded.lock().unwrap().push(request.clone());
                if request.path.ends_with("/git/blobs") && gate.swap(false, Ordering::SeqCst) {
                    entered.notify_one();
                    released.notified().await;
                }
                let (status, body) = handler(&request);
                let header = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                socket.write_all(header.as_bytes()).await.unwrap();
                socket.write_all(&body).await.unwrap();
            }
        });
        Self {
            endpoints: RemoteEndpoints {
                github: format!("{base}/github"),
                drive: format!("{base}/drive"),
                drive_upload: format!("{base}/upload"),
            },
            requests,
            task,
            pause_blob,
            paused,
            resume,
        }
    }
}
impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn archive(entries: HashMap<String, Vec<u8>>) -> Vec<u8> {
    let mut archive = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    ));
    for (path, bytes) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        archive
            .append_data(&mut header, format!("root/{path}"), bytes.as_slice())
            .unwrap();
    }
    archive.into_inner().unwrap().finish().unwrap()
}

struct GitHubFixture {
    manifest: Value,
    sidecars: bool,
    backup: Option<Vec<u8>>,
    files: HashMap<String, Vec<u8>>,
    head: String,
    counter: u64,
    blobs: HashMap<String, Vec<u8>>,
    tree: Vec<Value>,
    fail_blob: bool,
    fail_ref_response: bool,
    advance_on_commit: bool,
}
impl GitHubFixture {
    fn new(manifest: Value, files: HashMap<String, Vec<u8>>) -> Self {
        Self {
            manifest,
            sidecars: false,
            backup: None,
            files,
            head: "a".repeat(40),
            counter: 1,
            blobs: HashMap::new(),
            tree: Vec::new(),
            fail_blob: false,
            fail_ref_response: false,
            advance_on_commit: false,
        }
    }
    fn repository_files(&self) -> HashMap<String, Vec<u8>> {
        let mut entries = if self.sidecars {
            crate::repository_metadata::records(&self.manifest).unwrap()
        } else {
            HashMap::new()
        };
        entries.insert(
            "manifest.json".into(),
            if self.sidecars {
                crate::repository_metadata::MARKER.to_vec()
            } else {
                serde_json::to_vec(&self.manifest).unwrap()
            },
        );
        if let Some(backup) = &self.backup {
            entries.insert(crate::repository_metadata::BACKUP.into(), backup.clone());
        }
        for (id, bytes) in &self.files {
            if self.manifest["nodes"][id]["type"] == "file" {
                entries.insert(
                    format!("files/{}", file_name(&self.manifest["nodes"][id]).unwrap()),
                    bytes.clone(),
                );
            }
        }
        entries
    }
    fn handle(&mut self, request: &Request) -> (u16, Vec<u8>) {
        let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
        let reply = |value: Value| (200, serde_json::to_vec(&value).unwrap());
        if request.path.contains("/branches/") {
            return reply(json!({"commit": {"sha": self.head}}));
        }
        if request.path.contains("/tarball/") {
            return (200, archive(self.repository_files()));
        }
        if request.method == "GET" && request.path.contains("/git/commits/") {
            return reply(json!({"tree": {"sha": "b".repeat(40)}}));
        }
        if request.method == "GET" && request.path.contains("/git/trees/") {
            let tree: Vec<_> = self.repository_files().iter().map(|(path,bytes)|json!({"path":path,"type":"blob","mode":"100644","sha":git2::Oid::hash_object(git2::ObjectType::Blob,bytes).unwrap().to_string()})).collect();
            return reply(json!({"tree": tree, "truncated": false}));
        }
        if request.method == "GET" && request.path.contains("/git/blobs/") {
            let sha = request.path.rsplit('/').next().unwrap();
            let entries = self.repository_files();
            let bytes = entries
                .values()
                .find(|bytes| {
                    git2::Oid::hash_object(git2::ObjectType::Blob, bytes)
                        .unwrap()
                        .to_string()
                        == sha
                })
                .unwrap();
            return reply(json!({"encoding": "base64", "content": STANDARD.encode(bytes)}));
        }
        if request.path.ends_with("/git/blobs") {
            if self.fail_blob {
                self.fail_blob = false;
                return (500, b"retry".to_vec());
            }
            let bytes = STANDARD.decode(body["content"].as_str().unwrap()).unwrap();
            let sha = git2::Oid::hash_object(git2::ObjectType::Blob, &bytes)
                .unwrap()
                .to_string();
            self.blobs.insert(sha.clone(), bytes);
            return reply(json!({"sha": sha}));
        }
        if request.path.ends_with("/git/trees") {
            self.tree = body["tree"].as_array().unwrap().clone();
            return reply(json!({"sha": "c".repeat(40)}));
        }
        if request.method == "POST" && request.path.ends_with("/git/commits") {
            self.counter += 1;
            if self.advance_on_commit {
                self.advance_on_commit = false;
                self.head = "e".repeat(40);
            }
            return reply(json!({"sha": format!("{:040x}", self.counter)}));
        }
        if request.method == "PATCH" && request.path.contains("/git/refs/heads/") {
            let mut records = if self.sidecars {
                crate::repository_metadata::records(&self.manifest).unwrap()
            } else {
                HashMap::new()
            };
            for item in &self.tree {
                let path = item["path"].as_str().unwrap();
                let bytes = item["sha"].as_str().map(|sha| self.blobs[sha].clone());
                if path == "manifest.json" {
                    self.sidecars = crate::repository_metadata::is_marker(bytes.as_ref().unwrap());
                    if !self.sidecars {
                        self.manifest = serde_json::from_slice(bytes.as_ref().unwrap()).unwrap();
                    }
                } else if path == crate::repository_metadata::BACKUP {
                    self.backup = bytes;
                } else if path == crate::repository_metadata::SETTINGS
                    || crate::repository_metadata::is_metadata_path(path)
                {
                    if let Some(bytes) = bytes {
                        records.insert(path.into(), bytes);
                    } else {
                        records.remove(path);
                    }
                } else {
                    let file = path.strip_prefix("files/").unwrap();
                    let id = file.rsplit_once('.').unwrap().0;
                    if let Some(bytes) = bytes {
                        self.files.insert(id.into(), bytes);
                    } else {
                        self.files.remove(id);
                    }
                }
            }
            if self.sidecars {
                self.manifest = crate::repository_metadata::assemble(&records).unwrap();
            }
            self.head = body["sha"].as_str().unwrap().into();
            if self.fail_ref_response {
                self.fail_ref_response = false;
                return (500, b"lost ref response".to_vec());
            }
            return reply(json!({}));
        }
        panic!(
            "unexpected GitHub fixture request {} {}",
            request.method, request.path
        )
    }
}

#[tokio::test]
async fn native_metadata_deletes_and_head_conflict_retry_preserve_remote_nodes_and_ambiguous_pushes(
) {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let mut manifest = manifest_with("canvas", "mcanvas");
    manifest["nodes"]["folder"] = json!({"id": "folder", "type": "folder", "name": "Folder", "parentId": null, "tags": [], "createdAt": 1, "modifiedAt": 1});
    manifest["nodes"]["canvas"]["parentId"] = json!("folder");
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        manifest,
        HashMap::from([("canvas".into(), fixture_bytes("baseUpdate"))]),
    )));
    let remote = state.clone();
    let server = TestServer::new(move |request| remote.lock().unwrap().handle(request)).await;
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert!(engine.store.lock().unwrap().outbox.is_empty());
    let (saved, read_changes) = engine.operate(RepositoryOperation::Manifest).await.unwrap();
    assert!(!read_changes.wake_remote);
    let mut manifest = saved["manifest"].clone();
    manifest["nodes"]["folder"]["name"] = json!("Renamed");
    manifest["tagRegistry"] = json!(["native/tag"]);
    save_manifest(&engine, manifest).await;
    {
        let mut remote = state.lock().unwrap();
        remote.manifest["nodes"]["remote-image"] = node("remote-image", "png");
        remote
            .files
            .insert("remote-image".into(), b"remote only".to_vec());
        remote.head = "d".repeat(40);
        remote.advance_on_commit = true;
    }
    assert!(engine
        .cycle(github_source(), &server.endpoints)
        .await
        .err()
        .unwrap()
        .contains("branch changed"));
    assert!(!engine.store.lock().unwrap().outbox.is_empty());
    state.lock().unwrap().fail_ref_response = true;
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert_eq!(
        engine.store.lock().unwrap().manifest["nodes"]["remote-image"]["name"],
        "remote-image.png"
    );
    assert_eq!(
        state.lock().unwrap().manifest["nodes"]["folder"]["name"],
        "Renamed"
    );
    assert_eq!(
        state.lock().unwrap().manifest["tagRegistry"],
        json!(["native/tag"])
    );
    let (saved, _) = engine.operate(RepositoryOperation::Manifest).await.unwrap();
    let mut manifest = saved["manifest"].clone();
    manifest["nodes"].as_object_mut().unwrap().remove("folder");
    manifest["nodes"].as_object_mut().unwrap().remove("canvas");
    save_manifest(&engine, manifest).await;
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert!(state.lock().unwrap().manifest["nodes"]["canvas"].is_null());
    assert!(!state.lock().unwrap().files.contains_key("canvas"));
    assert_eq!(read(&engine, "remote-image").await, b"remote only");
    assert!(engine.store.lock().unwrap().outbox.is_empty());
}

struct DriveFile {
    id: String,
    parent: String,
    name: String,
    revision: String,
    bytes: Vec<u8>,
    app_properties: HashMap<String, String>,
}
struct DriveFixture {
    files: Vec<DriveFile>,
    counter: usize,
    fail_upload: bool,
}
impl DriveFixture {
    fn new() -> Self {
        Self {
            files: vec![
                DriveFile {
                    id: "manifest-entry".into(),
                    parent: "folder-1".into(),
                    name: "manifest.json".into(),
                    revision: "manifest-r1".into(),
                    app_properties: HashMap::new(),
                    bytes: serde_json::to_vec(&manifest_with("canvas", "mcanvas")).unwrap(),
                },
                DriveFile {
                    id: "files-folder".into(),
                    parent: "folder-1".into(),
                    name: "files".into(),
                    revision: "folder-r1".into(),
                    app_properties: HashMap::new(),
                    bytes: Vec::new(),
                },
                DriveFile {
                    id: "canvas-entry".into(),
                    parent: "files-folder".into(),
                    name: "canvas.myelin".into(),
                    revision: "canvas-r1".into(),
                    app_properties: HashMap::new(),
                    bytes: fixture_bytes("baseUpdate"),
                },
            ],
            counter: 1,
            fail_upload: false,
        }
    }
    fn manifest(&self) -> Value {
        let marker = &self
            .files
            .iter()
            .find(|file| file.name == "manifest.json")
            .unwrap()
            .bytes;
        if !crate::repository_metadata::is_marker(marker) {
            return serde_json::from_slice(marker).unwrap();
        }
        let records = self
            .files
            .iter()
            .filter_map(|file| {
                let path = if file.name == "repository.json" {
                    file.name.clone()
                } else {
                    format!("files/{}", file.name)
                };
                (path == crate::repository_metadata::SETTINGS
                    || crate::repository_metadata::is_metadata_path(&path))
                .then(|| (path, file.bytes.clone()))
            })
            .collect();
        crate::repository_metadata::assemble(&records).unwrap()
    }
    fn metadata(file: &DriveFile) -> Value {
        json!({"id": file.id, "name": file.name, "headRevisionId": file.revision, "appProperties": file.app_properties})
    }
    fn handle(&mut self, request: &Request) -> (u16, Vec<u8>) {
        let url =
            tauri_plugin_http::reqwest::Url::parse(&format!("http://fixture{}", request.path))
                .unwrap();
        let reply = |value: Value| (200, serde_json::to_vec(&value).unwrap());
        if request.method == "GET" && url.path() == "/drive/files" {
            let query = url.query_pairs().find(|(key, _)| key == "q").unwrap().1;
            let parent = if query.contains("'folder-1' in parents") {
                "folder-1"
            } else {
                "files-folder"
            };
            let name = query
                .split("name = '")
                .nth(1)
                .map(|suffix| suffix.split('\'').next().unwrap());
            let files = self
                .files
                .iter()
                .filter(|file| file.parent == parent && name.is_none_or(|name| name == file.name))
                .map(Self::metadata)
                .collect::<Vec<_>>();
            return reply(json!({"files": files}));
        }
        if request.method == "GET" && url.path().starts_with("/drive/files/") {
            let id = url.path().split('/').nth(3).unwrap();
            return self
                .files
                .iter()
                .find(|file| file.id == id)
                .map(|file| (200, file.bytes.clone()))
                .unwrap_or((404, Vec::new()));
        }
        if request.method == "PATCH" && url.path().starts_with("/upload/files/") {
            if self.fail_upload {
                self.fail_upload = false;
                return (500, b"interrupted upload".to_vec());
            }
            let id = url.path().split('/').nth(3).unwrap();
            let file = self.files.iter_mut().find(|file| file.id == id).unwrap();
            self.counter += 1;
            file.revision = format!("upload-r{}", self.counter);
            file.bytes = request.body.clone();
            return reply(Self::metadata(file));
        }
        if request.method == "POST" && url.path() == "/upload/files" {
            let body = String::from_utf8(request.body.clone()).unwrap();
            let boundary = body.lines().next().unwrap();
            let parts: Vec<_> = body.split(boundary).collect();
            let info: Value =
                serde_json::from_str(parts[1].split_once("\r\n\r\n").unwrap().1.trim()).unwrap();
            let bytes = parts[2]
                .split_once("\r\n\r\n")
                .unwrap()
                .1
                .strip_suffix("\r\n")
                .unwrap()
                .as_bytes()
                .to_vec();
            self.counter += 1;
            let name = info["name"].as_str().unwrap();
            let id = match name {
                "repository.json" => "settings-entry".into(),
                "manifest.legacy.json" => "backup-entry".into(),
                "manifest.json" => "manifest-entry".into(),
                _ => format!("meta-{}", name.strip_suffix(".meta.json").unwrap()),
            };
            let file = DriveFile {
                id,
                name: name.into(),
                parent: info["parents"][0].as_str().unwrap().into(),
                revision: format!("create-r{}", self.counter),
                app_properties: HashMap::new(),
                bytes,
            };
            let result = Self::metadata(&file);
            self.files.push(file);
            return reply(result);
        }
        if request.method == "POST" && url.path() == "/drive/files" {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            self.counter += 1;
            let file = DriveFile {
                id: format!("created-{}", self.counter),
                parent: body["parents"][0].as_str().unwrap().into(),
                name: body["name"].as_str().unwrap().into(),
                revision: format!("create-r{}", self.counter),
                app_properties: serde_json::from_value(body["appProperties"].clone())
                    .unwrap_or_default(),
                bytes: Vec::new(),
            };
            let result = Self::metadata(&file);
            self.files.push(file);
            return reply(result);
        }
        if request.method == "DELETE" && url.path().starts_with("/drive/files/") {
            let id = url.path().split('/').nth(3).unwrap();
            self.files.retain(|file| file.id != id);
            return reply(json!({}));
        }
        panic!(
            "unexpected Drive fixture request {} {}",
            request.method, request.path
        )
    }
}
fn drive_source() -> RepositorySource {
    RepositorySource::GoogleDrive {
        folder_id: "folder-1".into(),
        token: "fixture".into(),
    }
}

#[tokio::test]
async fn cloud_canvas_events_send_deltas_and_leave_unopened_documents_uncached() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let mut manifest = manifest_with("canvas", "mcanvas");
    manifest["nodes"]["closed"] = node("closed", "mcanvas");
    manifest["nodes"]["version"] = node("version", "mcanvas");
    manifest["nodes"]["version"]["system"] = json!({
        "kind": "file-version", "sourceFileId": "canvas", "capturedAt": 1,
        "byteLength": fixture_bytes("baseUpdate").len()
    });
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        manifest,
        HashMap::from([
            ("canvas".into(), fixture_bytes("baseUpdate")),
            ("closed".into(), fixture_bytes("baseUpdate")),
            ("version".into(), fixture_bytes("baseUpdate")),
        ]),
    )));
    let remote = state.clone();
    let server = TestServer::new(move |request| remote.lock().unwrap().handle(request)).await;
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert!(engine.store.lock().unwrap().documents.is_empty());
    engine
        .operate(RepositoryOperation::Subscribe {
            node_id: "canvas".into(),
            session_id: "editor".into(),
        })
        .await
        .unwrap();
    let (opened, _) = engine
        .operate(RepositoryOperation::Document {
            node_id: "canvas".into(),
            state_vector_base64: None,
        })
        .await
        .unwrap();
    let editor = document::decode(
        &STANDARD
            .decode(opened["updateBase64"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    let edits = document::decode(&fixture_bytes("baseUpdate")).unwrap();
    document::apply(&edits, &fixture_bytes("localUpdate")).unwrap();
    document::apply(&edits, &fixture_bytes("remoteUpdate")).unwrap();
    for (index, delete) in [false, true].into_iter().enumerate() {
        if delete {
            document::apply(&edits, &fixture_bytes("deletionUpdate")).unwrap();
        }
        {
            let mut remote = state.lock().unwrap();
            remote
                .files
                .insert("canvas".into(), document::bytes(&edits));
            remote.head = format!("{:040x}", index + 200);
        }
        let changes = engine
            .cycle(github_source(), &server.endpoints)
            .await
            .unwrap();
        assert_eq!(changes.documents.len(), 1);
        let mut events = Vec::new();
        engine.emit_document_change(&changes.documents[0], |event, payload| {
            events.push((event.to_owned(), serde_json::to_value(payload).unwrap()));
        });
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "repository-document-editor");
        let delta = STANDARD
            .decode(events[0].1["updateBase64"].as_str().unwrap())
            .unwrap();
        assert!(
            delta.len() < 8192,
            "existing PDF was included: {} bytes",
            delta.len()
        );
        assert!(document::apply(&editor, &delta).unwrap());
        assert!(!document::apply(&editor, &read(&engine, "canvas").await).unwrap());
        assert_eq!(engine.store.lock().unwrap().documents.len(), 1);
    }
    assert_document(&document::bytes(&editor));
    assert_document(&read(&engine, "canvas").await);
}

#[tokio::test]
async fn native_incremental_github_pull_keeps_unchanged_media_and_falls_back_without_a_basis() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let mut manifest = manifest_with("canvas", "mcanvas");
    manifest["nodes"]["picture"] = node("picture", "png");
    manifest["nodes"]["removed"] = node("removed", "png");
    let picture = vec![42; 1024 * 1024];
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        manifest,
        HashMap::from([
            ("canvas".into(), fixture_bytes("baseUpdate")),
            ("picture".into(), picture.clone()),
            ("removed".into(), b"remove me".to_vec()),
        ]),
    )));
    let remote = state.clone();
    let truncate = Arc::new(AtomicBool::new(false));
    let truncate_tree = truncate.clone();
    let corrupt = Arc::new(AtomicBool::new(false));
    let corrupt_blob = corrupt.clone();
    let server = TestServer::new(move |request| {
        if request.method == "GET"
            && request.path.contains("/git/blobs/")
            && corrupt_blob.swap(false, Ordering::SeqCst)
        {
            return (
                200,
                serde_json::to_vec(
                    &json!({"encoding": "base64", "content": STANDARD.encode(b"wrong blob")}),
                )
                .unwrap(),
            );
        }
        if request.method == "GET"
            && request.path.contains("/git/trees/")
            && truncate_tree.swap(false, Ordering::SeqCst)
        {
            return (
                200,
                serde_json::to_vec(&json!({"tree": [], "truncated": true})).unwrap(),
            );
        }
        remote.lock().unwrap().handle(request)
    })
    .await;
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    let basis_root = engine
        .cache_dir
        .join("repository-bases")
        .join(store::revision(engine.id.as_bytes()));
    let old_basis = basis_root.join(engine.store.lock().unwrap().sync.basis_id.as_ref().unwrap());
    #[cfg(unix)]
    let inode = {
        use std::os::unix::fs::MetadataExt;
        fs::metadata(old_basis.join("files/picture.png"))
            .unwrap()
            .ino()
    };
    {
        let mut remote = state.lock().unwrap();
        remote.files.insert(
            "canvas".into(),
            document::merge(&fixture_bytes("baseUpdate"), &fixture_bytes("localUpdate")).unwrap(),
        );
        remote.manifest["nodes"]["added"] = node("added", "png");
        remote.files.insert("added".into(), b"new media".to_vec());
        remote.manifest["nodes"]
            .as_object_mut()
            .unwrap()
            .remove("removed");
        remote.files.remove("removed");
        remote.manifest["deletedNodes"]["removed"] = json!("remote-deletion");
        remote.head = "d".repeat(40);
    }
    let before = server.requests.lock().unwrap().len();
    let changes = engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert!(changes.deleted.contains(&"removed".to_owned()));
    assert_eq!(read(&engine, "picture").await, picture);
    assert_eq!(read(&engine, "added").await, b"new media");
    let doc = document::decode(&read(&engine, "canvas").await).unwrap();
    assert_eq!(
        doc.transact()
            .get_text("content")
            .unwrap()
            .get_string(&doc.transact()),
        "seed local"
    );
    {
        let requests = server.requests.lock().unwrap();
        let requested = &requests[before..];
        assert!(!requested
            .iter()
            .any(|request| request.path.contains("/tarball/")));
        assert_eq!(
            requested
                .iter()
                .filter(|request| request.method == "GET" && request.path.contains("/git/blobs/"))
                .count(),
            4
        );
        let picture_sha = git2::Oid::hash_object(git2::ObjectType::Blob, &picture)
            .unwrap()
            .to_string();
        assert!(!requested
            .iter()
            .any(|request| request.path.ends_with(&format!("/git/blobs/{picture_sha}"))));
        assert!(requested.iter().any(|request| request
            .path
            .ends_with(&format!("/git/commits/{}", "d".repeat(40)))));
    }
    let basis = basis_root.join(engine.store.lock().unwrap().sync.basis_id.as_ref().unwrap());
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        assert_eq!(
            fs::metadata(basis.join("files/picture.png")).unwrap().ino(),
            inode
        );
    }
    drop(engine);
    let engine = directory.engine(true);
    assert_eq!(read(&engine, "picture").await, picture);
    fs::remove_file(basis.join("files/picture.png")).unwrap();
    state.lock().unwrap().head = "e".repeat(40);
    let before = server.requests.lock().unwrap().len();
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert!(server.requests.lock().unwrap()[before..]
        .iter()
        .any(|request| request.path.contains("/tarball/")));
    assert_eq!(read(&engine, "picture").await, picture);
    truncate.store(true, Ordering::SeqCst);
    state.lock().unwrap().head = "f".repeat(40);
    let before = server.requests.lock().unwrap().len();
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert!(server.requests.lock().unwrap()[before..]
        .iter()
        .any(|request| request.path.contains("/tarball/")));
    corrupt.store(true, Ordering::SeqCst);
    state.lock().unwrap().head = "1".repeat(40);
    state.lock().unwrap().manifest["nodes"]["canvas"]["name"] = json!("Changed metadata");
    assert!(engine
        .cycle(github_source(), &server.endpoints)
        .await
        .err()
        .unwrap()
        .contains("pinned revision"));
    assert_eq!(read(&engine, "picture").await, picture);
    let basis = basis_root.join(engine.store.lock().unwrap().sync.basis_id.as_ref().unwrap());
    let sync = fs::read(basis.join("sync.json")).unwrap();
    let mut invalid: Value = serde_json::from_slice(&sync).unwrap();
    invalid["basisId"] = json!("../another-basis");
    fs::write(
        basis.join("sync.json"),
        serde_json::to_vec(&invalid).unwrap(),
    )
    .unwrap();
    assert!(engine
        .cycle(github_source(), &server.endpoints)
        .await
        .err()
        .unwrap()
        .contains("Invalid native remote basis"));
    fs::write(basis.join("sync.json"), sync).unwrap();
}

#[tokio::test]
async fn native_incremental_drive_pull_reuses_media_only_with_matching_id_and_revision() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let state = Arc::new(Mutex::new(DriveFixture::new()));
    let picture = vec![42; 1024 * 1024];
    {
        let mut remote = state.lock().unwrap();
        let mut manifest = manifest_with("canvas", "mcanvas");
        manifest["nodes"]["picture"] = node("picture", "png");
        remote.files[0].bytes = serde_json::to_vec(&manifest).unwrap();
        remote.files.push(DriveFile {
            id: "picture-entry".into(),
            parent: "files-folder".into(),
            name: "picture.png".into(),
            revision: "picture-r1".into(),
            bytes: picture.clone(),
            app_properties: HashMap::new(),
        });
    }
    let remote = state.clone();
    let server = TestServer::new(move |request| remote.lock().unwrap().handle(request)).await;
    engine
        .cycle(drive_source(), &server.endpoints)
        .await
        .unwrap();
    let basis_root = engine
        .cache_dir
        .join("repository-bases")
        .join(store::revision(engine.id.as_bytes()));
    #[cfg(unix)]
    let inode = {
        use std::os::unix::fs::MetadataExt;
        let basis = engine.store.lock().unwrap().sync.basis_id.clone().unwrap();
        fs::metadata(basis_root.join(basis).join("files/picture.png"))
            .unwrap()
            .ino()
    };
    {
        let mut remote = state.lock().unwrap();
        let canvas = remote
            .files
            .iter_mut()
            .find(|file| file.id == "canvas-entry")
            .unwrap();
        canvas.revision = "canvas-r2".into();
        canvas.bytes =
            document::merge(&fixture_bytes("baseUpdate"), &fixture_bytes("localUpdate")).unwrap();
    }
    let before = server.requests.lock().unwrap().len();
    engine
        .cycle(drive_source(), &server.endpoints)
        .await
        .unwrap();
    assert_eq!(read(&engine, "picture").await, picture);
    let doc = document::decode(&read(&engine, "canvas").await).unwrap();
    assert_eq!(
        doc.transact()
            .get_text("content")
            .unwrap()
            .get_string(&doc.transact()),
        "seed local"
    );
    {
        let requests = server.requests.lock().unwrap();
        let requested = &requests[before..];
        assert!(!requested
            .iter()
            .any(|request| request.path.contains("/drive/files/picture-entry/")));
        assert_eq!(
            requested
                .iter()
                .filter(|request| request
                    .path
                    .contains("/drive/files/canvas-entry/revisions/canvas-r2"))
                .count(),
            1
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let basis = engine.store.lock().unwrap().sync.basis_id.clone().unwrap();
        assert_eq!(
            fs::metadata(basis_root.join(basis).join("files/picture.png"))
                .unwrap()
                .ino(),
            inode
        );
    }
    drop(engine);
    let engine = directory.engine(true);
    {
        let mut remote = state.lock().unwrap();
        let media = remote
            .files
            .iter_mut()
            .find(|file| file.name == "picture.png")
            .unwrap();
        media.id = "replacement-picture".into();
        media.bytes = b"replacement media".to_vec();
    }
    let before = server.requests.lock().unwrap().len();
    engine
        .cycle(drive_source(), &server.endpoints)
        .await
        .unwrap();
    assert!(read(&engine, "picture").await == b"replacement media");
    assert!(server.requests.lock().unwrap()[before..]
        .iter()
        .any(|request| request
            .path
            .contains("/drive/files/replacement-picture/revisions/picture-r1")));
}

#[tokio::test]
async fn native_drive_pull_upload_retry_reopen_and_idle_metadata_check_preserve_bytes() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let state = Arc::new(Mutex::new(DriveFixture::new()));
    let remote = state.clone();
    let server = TestServer::new(move |request| remote.lock().unwrap().handle(request)).await;
    engine
        .cycle(drive_source(), &server.endpoints)
        .await
        .unwrap();
    assert!(engine.store.lock().unwrap().outbox.is_empty());
    update(&engine, "localUpdate", "local").await;
    update(&engine, "remoteUpdate", "peer").await;
    update(&engine, "deletionUpdate", "peer").await;
    state.lock().unwrap().fail_upload = true;
    assert!(engine
        .cycle(drive_source(), &server.endpoints)
        .await
        .is_err());
    assert!(!engine.store.lock().unwrap().outbox.is_empty());
    drop(engine);
    let reopened = directory.engine(true);
    reopened
        .cycle(drive_source(), &server.endpoints)
        .await
        .unwrap();
    assert!(reopened.store.lock().unwrap().outbox.is_empty());
    assert_document(&read(&reopened, "canvas").await);
    let remote = state.lock().unwrap();
    assert_document(
        &remote
            .files
            .iter()
            .find(|file| file.id == "canvas-entry")
            .unwrap()
            .bytes,
    );
    let manifest = remote.manifest();
    assert_eq!(
        manifest["linksBySource"]["canvas"],
        fixture()["expected"]["links"]
    );
    drop(remote);
    let before = server.requests.lock().unwrap().len();
    reopened
        .cycle(drive_source(), &server.endpoints)
        .await
        .unwrap();
    let requests = server.requests.lock().unwrap();
    assert!(requests[before..]
        .iter()
        .all(|request| request.method == "GET" && request.path.starts_with("/drive/files?")));
    let uploads = requests
        .iter()
        .filter(|request| request.method == "PATCH" && request.path.starts_with("/upload/"))
        .collect::<Vec<_>>();
    assert!(uploads.iter().any(|request| request.body.len() > 8192));
    assert!(uploads.last().unwrap().path.contains("settings-entry"));
    let basis_root = reopened
        .cache_dir
        .join("repository-bases")
        .join(store::revision(reopened.id.as_bytes()));
    assert_eq!(fs::read_dir(basis_root).unwrap().count(), 1);
}
fn github_source() -> RepositorySource {
    RepositorySource::Github {
        owner: "owner".into(),
        repo: "repo".into(),
        branch: "feature/notes".into(),
        token: "fixture".into(),
    }
}
fn manifest_with(id: &str, kind: &str) -> Value {
    let mut manifest = crate::repository_metadata::empty_manifest();
    manifest["nodes"][id] = node(id, kind);
    manifest
}

#[tokio::test]
async fn native_github_upload_retains_newer_deltas_retries_and_reuses_a_single_remote_basis() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let remote_bytes =
        document::merge(&fixture_bytes("baseUpdate"), &fixture_bytes("remoteUpdate")).unwrap();
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        manifest_with("canvas", "mcanvas"),
        HashMap::from([("canvas".into(), remote_bytes)]),
    )));
    let remote_state = state.clone();
    let server = TestServer::new(move |request| remote_state.lock().unwrap().handle(request)).await;
    seed(&engine, "canvas", "mcanvas", fixture_bytes("baseUpdate")).await;
    update(&engine, "localUpdate", "local").await;
    server.pause_blob.store(true, Ordering::SeqCst);
    let uploading_engine = engine.clone();
    let endpoints = server.endpoints.clone();
    let upload =
        tokio::spawn(async move { uploading_engine.cycle(github_source(), &endpoints).await });
    tokio::time::timeout(std::time::Duration::from_secs(10), server.paused.notified())
        .await
        .unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        update(&engine, "deletionUpdate", "local"),
    )
    .await
    .unwrap();
    server.resume.notify_one();
    upload.await.unwrap().unwrap();
    assert_document(&read(&engine, "canvas").await);
    assert_eq!(
        engine
            .store
            .lock()
            .unwrap()
            .outbox
            .iter()
            .filter(|op| op["kind"] == "push-note")
            .count(),
        1
    );
    let first_basis = engine.store.lock().unwrap().sync.basis_id.clone().unwrap();
    state.lock().unwrap().fail_blob = true;
    let failed_trace = telemetry::SyncTrace::new();
    assert!(failed_trace
        .scope(engine.cycle(github_source(), &server.endpoints))
        .await
        .is_err());
    let failed = failed_trace.fields();
    assert_eq!(failed["last_failed_stage"], "git_rest");
    assert!(failed["upload_ms"].is_number());
    assert!(!failed.contains_key("save_basis_ms"));
    assert_eq!(
        engine.store.lock().unwrap().sync.basis_id.as_deref(),
        Some(first_basis.as_str())
    );
    assert!(!engine.store.lock().unwrap().outbox.is_empty());
    let trace = telemetry::SyncTrace::new();
    trace
        .scope(engine.cycle(github_source(), &server.endpoints))
        .await
        .unwrap();
    let fields = trace.fields();
    for phase in [
        "capture_ms",
        "remote_check_ms",
        "read_basis_ms",
        "plan_ms",
        "upload_ms",
        "git_rest_ms",
        "save_basis_ms",
        "publish_ms",
        "cleanup_ms",
    ] {
        assert!(fields[phase].is_number(), "{phase}");
    }
    assert_eq!(fields["basis_reused"], true);
    assert_eq!(fields["document_count"], 1);
    assert!(fields["upload_bytes"].as_u64().unwrap() > 0);
    assert!(fields["http_request_count"].as_u64().unwrap() > 0);
    assert!(!fields.contains_key("last_failed_stage"));
    assert!(engine.store.lock().unwrap().outbox.is_empty());
    assert_document(&state.lock().unwrap().files["canvas"]);
    let basis_root = engine
        .cache_dir
        .join("repository-bases")
        .join(store::revision(engine.id.as_bytes()));
    assert_eq!(fs::read_dir(basis_root).unwrap().count(), 1);
    let before = server.requests.lock().unwrap().len();
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    let requests = server.requests.lock().unwrap();
    assert_eq!(requests.len() - before, 1);
    assert_eq!(
        requests
            .iter()
            .filter(|request| request.path.contains("/tarball/"))
            .count(),
        1
    );
    assert!(requests
        .iter()
        .filter(|request| request.path.contains("/branches/"))
        .all(|request| request.path.contains("feature%2Fnotes")));
}

#[tokio::test]
async fn native_raw_sync_preserves_legacy_content_bases_and_makes_conflict_copies_before_extensions(
) {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let manifest = manifest_with("picture", "png");
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        manifest.clone(),
        HashMap::from([("picture".into(), b"original".to_vec())]),
    )));
    let remote = state.clone();
    let server = TestServer::new(move |request| remote.lock().unwrap().handle(request)).await;
    seed(&engine, "picture", "png", b"offline edit".to_vec()).await;
    {
        let mut store = engine.store.lock().unwrap();
        store.outbox = vec![
            json!({"kind": "push-note", "nodeId": "picture", "baseFileRevision": store::revision(b"original")}),
        ];
        store.commit(Vec::new()).unwrap();
    }
    drop(engine);
    let engine = directory.engine(true);
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert_eq!(state.lock().unwrap().files["picture"], b"offline edit");
    assert_eq!(
        state.lock().unwrap().manifest["nodes"]
            .as_object()
            .unwrap()
            .len(),
        1
    );
    engine
        .operate(RepositoryOperation::WriteFile {
            node: node("picture", "png"),
            bytes_base64: STANDARD.encode(b"new local bytes"),
            replace: true,
            overwrite_remote: false,
        })
        .await
        .unwrap();
    {
        let mut remote = state.lock().unwrap();
        remote.files.insert("picture".into(), Vec::new());
        remote.head = "d".repeat(40);
    }
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    let remote = state.lock().unwrap();
    assert_eq!(remote.files["picture"], Vec::<u8>::new());
    let (conflict_id, conflict) = remote.manifest["nodes"]
        .as_object()
        .unwrap()
        .iter()
        .find(|(id, _)| id.starts_with("conflict-"))
        .unwrap();
    assert_eq!(remote.files[conflict_id], b"new local bytes");
    let name = conflict["name"].as_str().unwrap();
    assert!(name.starts_with("picture (Conflicted copy "));
    assert!(name.ends_with(").png"));
    assert!(engine.store.lock().unwrap().outbox.is_empty());
}

#[tokio::test]
async fn native_imports_store_bytes_before_publishing() {
    let directory = TestDirectory::new();
    let engine = directory.engine(false);
    let bytes: Vec<u8> = (0..20000).map(|i| (i % 251) as u8).collect();
    engine
        .operate(RepositoryOperation::ImportedFile {
            node: node("import", "png"),
            bytes: bytes.clone(),
        })
        .await
        .unwrap();
    assert_eq!(
        fs::read(directory.0.join("data/files/import.png")).unwrap(),
        bytes
    );
    assert!(engine.store.lock().unwrap().manifest["nodes"]["import"].is_null());
    let mut manifest = engine.store.lock().unwrap().manifest.clone();
    manifest["nodes"]["import"] = node("import", "png");
    save_manifest(&engine, manifest).await;
    assert_eq!(read(&engine, "import").await, bytes);
}

#[tokio::test]
async fn native_reference_renames_update_text_marks_indexes_and_mergeable_deltas_without_replacing_documents(
) {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let fixture: Value = serde_json::from_str(include_str!("fixtures/yjs-renames.json")).unwrap();
    let bytes = STANDARD
        .decode(fixture["update"].as_str().unwrap())
        .unwrap();
    let original = document::decode(&bytes).unwrap();
    // An embedded binary must not be sent back as part of a link rename.
    let asset = vec![137u8; 1024 * 1024];
    original.get_or_insert_map("asset").insert(
        &mut original.transact_mut(),
        "bytes",
        Any::Buffer(asset.clone().into()),
    );
    let bytes = document::bytes(&original);
    seed(&engine, "source", "mcanvas", bytes.clone()).await;
    let before_generation =
        engine.store.lock().unwrap().sync.document_generations["source"].clone();
    let (result, changes) = engine
        .operate(RepositoryOperation::RenameReferences {
            source_ids: vec!["source".into(), "source".into(), "missing".into()],
            target_id: "target".into(),
            new_name: "新#Name\\x".into(),
            reference_kind: references::ReferenceKind::Note,
        })
        .await
        .unwrap();
    assert_eq!(result, json!({"sourceCount": 1, "linkCount": 4}));
    assert_eq!(changes.documents.len(), 1);
    let change = &changes.documents[0];
    assert!(!change.replacement);
    assert_eq!(change.generation, before_generation);
    assert!(change.bytes.len() < 8192);
    let open_editor = document::decode(&bytes).unwrap();
    open_editor.get_or_insert_text("unsaved").insert(
        &mut open_editor.transact_mut(),
        0,
        "Keep my edit",
    );
    document::apply(&open_editor, &change.bytes).unwrap();
    assert_eq!(
        open_editor
            .get_or_insert_text("unsaved")
            .get_string(&open_editor.transact()),
        "Keep my edit"
    );
    let renamed = document::decode(&read(&engine, "source").await).unwrap();
    assert_eq!(document::links(&open_editor), document::links(&renamed));
    let links = document::links(&renamed);
    assert_eq!(
        links
            .iter()
            .map(|link| link["title"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![
            "Folder/新\\#Name\\\\x#Draft",
            "Folder/新\\#Name\\\\x#Draft",
            "Other",
            "新\\#Name\\\\x",
            "No frame"
        ]
    );
    assert_eq!(links[0]["snippet"], "😀 before [[Folder/新\\#Name\\\\x#Draft]] between [[Folder/新\\#Name\\\\x#Draft]][[Folder/新\\#Name\\\\x#Draft]] after");
    assert_eq!(
        json!(links),
        engine.store.lock().unwrap().manifest["linksBySource"]["source"]
    );
    let (result, changes) = engine
        .operate(RepositoryOperation::RenameReferences {
            source_ids: vec!["source".into()],
            target_id: "frame".into(),
            new_name: "Final#\\😀".into(),
            reference_kind: references::ReferenceKind::PageFrame,
        })
        .await
        .unwrap();
    assert_eq!(result, json!({"sourceCount": 1, "linkCount": 3}));
    assert!(!changes.documents[0].replacement);
    let reopened = directory.engine(true);
    let restored = document::decode(&read(&reopened, "source").await).unwrap();
    let links = document::links(&restored);
    assert_eq!(
        links
            .iter()
            .map(|link| link["title"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![
            "Folder/新\\#Name\\\\x#Final\\#\\\\😀",
            "Folder/新\\#Name\\\\x#Final\\#\\\\😀",
            "Other",
            "新\\#Name\\\\x",
            "No frame"
        ]
    );
    let txn = restored.transact();
    let xml = txn.get_xml_fragment("pf-source").unwrap().get_string(&txn);
    assert!(xml.contains("[[Code]]"));
    assert!(xml.contains("[[Math]]"));
    assert!(!xml.contains("<bold>"));
    assert!(
        matches!(txn.get_map("asset").unwrap().get(&txn, "bytes"), Some(Out::Any(Any::Buffer(value))) if value.as_ref() == asset)
    );
    drop(txn);
    let (result, changes) = reopened
        .operate(RepositoryOperation::RenameReferences {
            source_ids: vec!["source".into()],
            target_id: "frame".into(),
            new_name: "Final#\\😀".into(),
            reference_kind: references::ReferenceKind::PageFrame,
        })
        .await
        .unwrap();
    assert_eq!(result, json!({"sourceCount": 0, "linkCount": 0}));
    assert!(changes.documents.is_empty());
    let before_failure = read(&reopened, "source").await;
    seed(&reopened, "corrupt", "mcanvas", vec![0, 0]).await;
    fs::write(directory.0.join("data/files/corrupt.myelin"), b"invalid").unwrap();
    reopened.store.lock().unwrap().documents.remove("corrupt");
    assert!(reopened
        .operate(RepositoryOperation::RenameReferences {
            source_ids: vec!["source".into(), "corrupt".into()],
            target_id: "target".into(),
            new_name: "Must roll back".into(),
            reference_kind: references::ReferenceKind::Note,
        })
        .await
        .is_err());
    let before_failure = document::decode(&before_failure).unwrap();
    let after_failure = document::decode(&read(&reopened, "source").await).unwrap();
    assert_eq!(
        after_failure.transact().state_vector(),
        before_failure.transact().state_vector()
    );
    assert_eq!(
        document::links(&after_failure),
        document::links(&before_failure)
    );
}

#[tokio::test]
async fn native_chunk_transfers_reject_bad_chunks_and_commit_only_complete_file_and_document_payloads(
) {
    let directory = TestDirectory::new();
    let engine = directory.engine(false);
    seed(&engine, "image", "png", b"old".to_vec()).await;
    let mut handle = RepositoryHandle {
        engine: engine.clone(),
        notes: HashMap::new(),
        transfers: HashMap::new(),
    };
    let bytes: Vec<u8> = (0..17000).map(|i| (i % 251) as u8).collect();
    for (index, chunk) in bytes.chunks(8192).enumerate() {
        assert!(handle
            .resolve_transfer(RepositoryOperation::StageBytes {
                transfer_id: "file".into(),
                offset: index * 8192,
                bytes_base64: STANDARD.encode(chunk)
            })
            .unwrap()
            .is_none());
        assert_eq!(read(&engine, "image").await, b"old");
    }
    assert!(handle
        .resolve_transfer(RepositoryOperation::StageBytes {
            transfer_id: "file".into(),
            offset: 0,
            bytes_base64: STANDARD.encode([1])
        })
        .is_err());
    assert!(handle
        .resolve_transfer(RepositoryOperation::StageBytes {
            transfer_id: "oversize".into(),
            offset: 0,
            bytes_base64: STANDARD.encode(vec![0; 8193])
        })
        .is_err());
    let operation = handle
        .resolve_transfer(RepositoryOperation::FinishTransfer {
            transfer_id: "file".into(),
            operation: Box::new(RepositoryOperation::WriteFile {
                node: node("image", "png"),
                bytes_base64: String::new(),
                replace: true,
                overwrite_remote: false,
            }),
        })
        .unwrap()
        .unwrap();
    engine.operate(operation).await.unwrap();
    assert_eq!(read(&engine, "image").await, bytes);
    assert!(handle.transfers.is_empty());
    seed(&engine, "canvas", "mcanvas", fixture_bytes("baseUpdate")).await;
    let editor = document::decode(&read(&engine, "canvas").await).unwrap();
    let before = document::vector(&editor);
    let text = "😀".repeat(5000);
    editor
        .get_or_insert_text("imported")
        .insert(&mut editor.transact_mut(), 0, &text);
    let (delta, _) = document::diff(&editor, Some(&before)).unwrap();
    for (index, chunk) in delta.chunks(8192).enumerate() {
        handle
            .resolve_transfer(RepositoryOperation::StageBytes {
                transfer_id: "doc".into(),
                offset: index * 8192,
                bytes_base64: STANDARD.encode(chunk),
            })
            .unwrap();
    }
    let operation = handle
        .resolve_transfer(RepositoryOperation::FinishTransfer {
            transfer_id: "doc".into(),
            operation: Box::new(RepositoryOperation::UpdateDocument {
                node_id: "canvas".into(),
                update_base64: String::new(),
                origin: "local".into(),
                generation: None,
                source_session: Some("editor".into()),
            }),
        })
        .unwrap()
        .unwrap();
    engine.operate(operation).await.unwrap();
    let persisted = document::decode(&read(&directory.engine(false), "canvas").await).unwrap();
    assert_eq!(
        persisted
            .get_or_insert_text("imported")
            .get_string(&persisted.transact()),
        text
    );
    handle
        .resolve_transfer(RepositoryOperation::StageBytes {
            transfer_id: "cancelled".into(),
            offset: 0,
            bytes_base64: STANDARD.encode([1, 2]),
        })
        .unwrap();
    handle
        .resolve_transfer(RepositoryOperation::CancelTransfer {
            transfer_id: "cancelled".into(),
        })
        .unwrap();
    assert!(handle
        .resolve_transfer(RepositoryOperation::FinishTransfer {
            transfer_id: "cancelled".into(),
            operation: Box::new(RepositoryOperation::WriteFile {
                node: node("image", "png"),
                bytes_base64: String::new(),
                replace: true,
                overwrite_remote: false
            })
        })
        .is_err());
    assert_eq!(read(&engine, "image").await, bytes);
}

#[tokio::test]
async fn onenote_import_persists_canvas_content_and_unique_titles_without_js() {
    use crate::onenote_import::{
        ImportedElement, ImportedNotebook, ImportedPage, ImportedSection, ImportedStroke,
    };
    use yrs::types::ToJson;

    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, 2, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[255, 0, 0, 255, 0, 255, 0, 255])
            .unwrap();
    }
    let notebook = ImportedNotebook {
        sections: vec![ImportedSection {
            folder_path: String::new(),
            name: "Section".into(),
            pages: vec![
                ImportedPage {
                    title: Some(" Page ".into()),
                    elements: vec![
                        ImportedElement::Text {
                            x: 10.0,
                            y: 20.0,
                            width: None,
                            text: "Hello".into(),
                            font_size: 16.0,
                            font_family: None,
                            color: "#123456".into(),
                        },
                        ImportedElement::Ink {
                            strokes: vec![ImportedStroke {
                                points: vec![1.0, 2.0, 3.0, 4.0],
                                color: "#654321".into(),
                                size: 2.0,
                            }],
                        },
                        ImportedElement::Image {
                            x: 5.0,
                            y: 6.0,
                            width: Some(10.0),
                            height: None,
                            data: png.clone(),
                        },
                        ImportedElement::Image {
                            x: 0.0,
                            y: 0.0,
                            width: None,
                            height: None,
                            data: vec![1, 2, 3],
                        },
                    ],
                },
                ImportedPage {
                    title: Some("Page".into()),
                    elements: vec![],
                },
                ImportedPage {
                    title: None,
                    elements: vec![],
                },
            ],
        }],
    };
    let progress = Arc::new(Mutex::new(Vec::new()));
    let captured = progress.clone();
    let (result, changes) = engine
        .operate(RepositoryOperation::ImportedOneNote {
            notebook,
            parent_id: None,
            root_name: "Notebook".into(),
            fallback_title: "Untitled".into(),
            progress: tauri::ipc::Channel::new(move |body| {
                let tauri::ipc::InvokeResponseBody::Json(body) = body else {
                    panic!("expected JSON progress")
                };
                captured
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str::<Value>(&body).unwrap());
                Ok(())
            }),
        })
        .await
        .unwrap();
    assert_eq!(result["pagesImported"], 3);
    assert_eq!(result["skippedPages"], 0);
    assert_eq!(changes.changed.len(), 4);
    assert!(changes.wake_remote);
    assert_eq!(
        *progress.lock().unwrap(),
        vec![
            json!({"current": 1, "total": 3, "fileName": "Page"}),
            json!({"current": 2, "total": 3, "fileName": "Page"}),
            json!({"current": 3, "total": 3, "fileName": "Untitled 3"}),
        ]
    );

    let mut reopened = Store::open(directory.0.join("data"), true).unwrap();
    let nodes = reopened.manifest["nodes"].as_object().unwrap();
    let mut names = nodes
        .values()
        .filter(|node| node["type"] == "file")
        .map(|node| node["name"].as_str().unwrap())
        .collect::<Vec<_>>();
    names.sort();
    assert_eq!(names, vec!["Page", "Page 1", "Untitled 3"]);
    assert!(nodes
        .values()
        .filter(|node| node["type"] == "file")
        .all(|node| node["parentId"] == result["rootFolderId"]));
    let id = nodes.values().find(|node| node["name"] == "Page").unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let doc = reopened.doc(&id).unwrap();
    let txn = doc.transact();
    let elements = txn.get_array("elements").unwrap();
    assert_eq!(elements.len(&txn), 3);
    let maps = elements
        .iter(&txn)
        .map(|value| match value {
            Out::YMap(map) => map,
            _ => panic!("element must be a Y.Map"),
        })
        .collect::<Vec<_>>();
    let text = maps[0].to_json(&txn);
    assert_eq!(text, Any::from_json(&json!({
        "type": 1, "uuid": maps[0].get(&txn, "uuid").unwrap().to_json(&txn),
        "offsetX": 170, "offsetY": 100, "scaleX": 1, "scaleY": 1,
        "text": "Hello", "color": "#123456", "fontSize": 16, "fontFamily": "sans-serif", "boxWidth": 400, "boxHeight": 0
    }).to_string()).unwrap());
    assert_eq!(
        maps[1].get(&txn, "points"),
        Some(Out::Any(Any::from(vec![
            161.0, 82.0, 0.0, 163.0, 84.0, 0.0
        ])))
    );
    assert_eq!(
        maps[1].get(&txn, "hasPressure"),
        Some(Out::Any(Any::Bool(false)))
    );
    assert_eq!(
        maps[2].get(&txn, "imageData"),
        Some(Out::Any(Any::Buffer(png.into())))
    );
    for (key, expected) in [
        ("naturalWidth", 2.0),
        ("naturalHeight", 1.0),
        ("scaleX", 5.0),
        ("scaleY", 1.0),
        ("offsetX", 165.0),
        ("offsetY", 86.0),
        ("cropW", 2.0),
        ("cropH", 1.0),
    ] {
        assert_eq!(
            maps[2].get(&txn, key),
            Some(Out::Any(Any::Number(expected)))
        );
    }
    drop(txn);
    assert_eq!(
        reopened
            .outbox
            .iter()
            .filter(|op| op["kind"] == "push-note")
            .count(),
        3
    );
}

#[tokio::test]
async fn onenote_import_preserves_shared_section_groups_and_rejects_missing_destinations() {
    use crate::onenote_import::{ImportedNotebook, ImportedPage, ImportedSection};
    let directory = TestDirectory::new();
    let engine = directory.engine(false);
    let notebook = || ImportedNotebook {
        sections: ["A", "B"]
            .into_iter()
            .map(|name| ImportedSection {
                folder_path: "Group/Nested".into(),
                name: name.into(),
                pages: vec![ImportedPage {
                    title: Some("Page".into()),
                    elements: vec![],
                }],
            })
            .collect(),
    };
    let operation = |parent_id| RepositoryOperation::ImportedOneNote {
        notebook: notebook(),
        parent_id,
        root_name: "Notebook".into(),
        fallback_title: "Untitled".into(),
        progress: tauri::ipc::Channel::new(|_| Ok(())),
    };
    assert!(engine
        .operate(operation(Some("missing".into())))
        .await
        .is_err());
    let (result, _) = engine.operate(operation(None)).await.unwrap();
    let reopened = Store::open(directory.0.join("data"), false).unwrap();
    let nodes = reopened.manifest["nodes"].as_object().unwrap();
    assert_eq!(nodes.len(), 7);
    let named = |name: &str| nodes.values().find(|node| node["name"] == name).unwrap();
    assert_eq!(named("Group")["parentId"], result["rootFolderId"]);
    assert_eq!(named("Nested")["parentId"], named("Group")["id"]);
    for name in ["A", "B"] {
        assert_eq!(named(name)["parentId"], named("Nested")["id"]);
        assert_eq!(
            nodes
                .values()
                .filter(|node| node["parentId"] == named(name)["id"] && node["type"] == "file")
                .count(),
            1
        );
    }
}

#[tokio::test]
async fn out_of_order_document_inserts_and_deletions_are_durable_before_acknowledgement() {
    for delete in [false, true] {
        let directory = TestDirectory::new();
        let engine = directory.engine(false);
        seed(&engine, "canvas", "mcanvas", vec![0, 0]).await;
        let source = yrs::Doc::new();
        let text = source.get_or_insert_text("content");
        let first = {
            let mut txn = source.transact_mut();
            text.insert(&mut txn, 0, "A");
            txn.encode_update_v1()
        };
        let second = {
            let mut txn = source.transact_mut();
            if delete {
                text.remove_range(&mut txn, 0, 1);
            } else {
                text.insert(&mut txn, 1, "B");
            }
            txn.encode_update_v1()
        };
        let apply = |bytes: &[u8]| RepositoryOperation::UpdateDocument {
            node_id: "canvas".into(),
            update_base64: STANDARD.encode(bytes),
            origin: "peer".into(),
            generation: None,
            source_session: None,
        };
        let (ack, _) = engine.operate(apply(&second)).await.unwrap();
        assert_eq!(ack["accepted"], true);
        let (repeated, changes) = engine.operate(apply(&second)).await.unwrap();
        assert_eq!(repeated["changed"], false);
        assert_eq!(repeated["revision"], ack["revision"]);
        assert!(changes.documents.is_empty());
        assert!(!changes.wake_remote);
        engine.checkpoint_pending().await.unwrap();
        assert!(engine.store.lock().unwrap().documents.is_empty());
        drop(engine);
        let reopened = directory.engine(false);
        reopened.operate(apply(&first)).await.unwrap();
        let doc = document::decode(&read(&reopened, "canvas").await).unwrap();
        assert_eq!(
            doc.get_or_insert_text("content")
                .get_string(&doc.transact()),
            if delete { "" } else { "AB" }
        );
        assert_eq!(ack["changed"], true);
    }
}

#[tokio::test]
async fn native_drive_new_file_uploads_resume_after_interruption_and_reopen() {
    for failure in ["media", "manifest", "media-response", "create-response"] {
        let directory = TestDirectory::new();
        let engine = directory.engine(true);
        let state = Arc::new(Mutex::new(DriveFixture::new()));
        let remote = state.clone();
        let fail_upload = Arc::new(AtomicBool::new(false));
        let fail = fail_upload.clone();
        let server = TestServer::new(move |request| {
            let matched = match failure {
                "manifest" => {
                    request.method == "POST"
                        && request.path.starts_with("/upload/files?")
                        && String::from_utf8_lossy(&request.body).contains("new-picture.meta.json")
                }
                "create-response" => {
                    request.method == "POST" && request.path.starts_with("/drive/files?")
                }
                _ => {
                    request.method == "PATCH" && request.path.starts_with("/upload/files/created-")
                }
            };
            if matched && fail.swap(false, Ordering::SeqCst) {
                if failure.ends_with("response") {
                    remote.lock().unwrap().handle(request);
                    return (200, b"lost response body".to_vec());
                }
                return (500, b"interrupted upload".to_vec());
            }
            remote.lock().unwrap().handle(request)
        })
        .await;
        engine
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        seed(&engine, "new-picture", "png", b"new picture".to_vec()).await;
        fail_upload.store(true, Ordering::SeqCst);
        assert!(
            engine
                .cycle(drive_source(), &server.endpoints)
                .await
                .is_err(),
            "{failure}"
        );
        drop(engine);
        let reopened = directory.engine(true);
        seed(&reopened, "new-picture", "png", b"newer picture".to_vec()).await;
        reopened
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        assert!(reopened.store.lock().unwrap().outbox.is_empty());
        let remote = state.lock().unwrap();
        let uploaded = remote
            .files
            .iter()
            .filter(|file| file.name == "new-picture.png")
            .collect::<Vec<_>>();
        assert_eq!(uploaded.len(), 1, "{failure}");
        assert_eq!(uploaded[0].bytes, b"newer picture", "{failure}");
        let manifest = remote.manifest();
        assert!(manifest["nodes"]["new-picture"].is_object());
        assert!(!reopened
            .cache_dir
            .join(format!(
                ".drive-uploads-{}.json",
                store::revision(b"folder-1")
            ))
            .exists());
    }
}

#[tokio::test]
async fn native_drive_unpublished_files_are_reused_only_when_bytes_match_or_upload_is_owned() {
    for owned in [false, true] {
        let directory = TestDirectory::new();
        let engine = directory.engine(true);
        let state = Arc::new(Mutex::new(DriveFixture::new()));
        let remote = state.clone();
        let fail_manifest = Arc::new(AtomicBool::new(false));
        let fail = fail_manifest.clone();
        let server = TestServer::new(move |request| {
            if request.method == "POST"
                && request.path.starts_with("/upload/files?")
                && String::from_utf8_lossy(&request.body).contains("new-picture.meta.json")
                && fail.swap(false, Ordering::SeqCst)
            {
                return (500, b"manifest upload failed".to_vec());
            }
            remote.lock().unwrap().handle(request)
        })
        .await;
        engine
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        seed(&engine, "new-picture", "png", b"new picture".to_vec()).await;
        fail_manifest.store(true, Ordering::SeqCst);
        assert!(engine
            .cycle(drive_source(), &server.endpoints)
            .await
            .is_err());
        if !owned {
            fs::remove_file(engine.cache_dir.join(format!(
                ".drive-uploads-{}.json",
                store::revision(b"folder-1")
            )))
            .unwrap();
        }
        {
            let mut remote = state.lock().unwrap();
            let file = remote
                .files
                .iter_mut()
                .find(|file| file.name == "new-picture.png")
                .unwrap();
            file.bytes = b"another client's picture".to_vec();
            file.revision = "another-upload".into();
            if !owned {
                file.app_properties.clear();
            }
        }
        assert!(engine
            .cycle(drive_source(), &server.endpoints)
            .await
            .err()
            .unwrap()
            .contains("file changed"));
        let remote = state.lock().unwrap();
        assert_eq!(
            remote
                .files
                .iter()
                .find(|file| file.name == "new-picture.png")
                .unwrap()
                .bytes,
            b"another client's picture"
        );
        assert!(!engine.store.lock().unwrap().outbox.is_empty());
        drop(remote);
        if !owned {
            let mut remote = state.lock().unwrap();
            let file = remote
                .files
                .iter_mut()
                .find(|file| file.name == "new-picture.png")
                .unwrap();
            file.bytes = b"new picture".to_vec();
            file.revision = "legacy-upload".into();
            drop(remote);
            let before = server.requests.lock().unwrap().len();
            engine
                .cycle(drive_source(), &server.endpoints)
                .await
                .unwrap();
            assert!(engine.store.lock().unwrap().outbox.is_empty());
            assert!(!server.requests.lock().unwrap()[before..]
                .iter()
                .any(|request| request.method == "PATCH"
                    && request.path.starts_with("/upload/files/created-")));
        }
    }
}

#[tokio::test]
async fn native_drive_deletions_publish_first_and_finish_after_interruption_and_reopen() {
    for failure in [
        "manifest",
        "manifest-response",
        "delete",
        "delete-response",
        "delete-changed",
        "delete-restored",
        "delete-restored-yjs",
        "delete-restored-yjs-changed",
        "delete-restored-yjs-upload-response",
    ] {
        let directory = TestDirectory::new();
        let engine = directory.engine(true);
        let state = Arc::new(Mutex::new(DriveFixture::new()));
        if !failure.starts_with("delete-restored-yjs") {
            let mut remote = state.lock().unwrap();
            remote
                .files
                .iter_mut()
                .find(|file| file.id == "manifest-entry")
                .unwrap()
                .bytes = serde_json::to_vec(&manifest_with("canvas", "png")).unwrap();
            let file = remote
                .files
                .iter_mut()
                .find(|file| file.id == "canvas-entry")
                .unwrap();
            file.name = "canvas.png".into();
            file.bytes = b"saved picture".to_vec();
        }
        let remote = state.clone();
        let interrupt = Arc::new(AtomicBool::new(false));
        let fail = interrupt.clone();
        let media_interrupt = Arc::new(AtomicBool::new(false));
        let media_fail = media_interrupt.clone();
        let server = TestServer::new(move |request| {
            let matched = if failure.starts_with("manifest") {
                request.method == "PATCH" && request.path.starts_with("/upload/files/meta-canvas")
            } else {
                request.method == "DELETE" && request.path.starts_with("/drive/files/canvas-entry")
            };
            if matched && fail.swap(false, Ordering::SeqCst) {
                if failure == "manifest-response" || failure == "delete-response" {
                    remote.lock().unwrap().handle(request);
                }
                return (400, b"interrupted response".to_vec());
            }
            if request.method == "PATCH"
                && request.path.starts_with("/upload/files/canvas-entry")
                && media_fail.swap(false, Ordering::SeqCst)
            {
                remote.lock().unwrap().handle(request);
                return (400, b"lost upload response".to_vec());
            }
            remote.lock().unwrap().handle(request)
        })
        .await;
        engine
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        let (saved, _) = engine.operate(RepositoryOperation::Manifest).await.unwrap();
        let mut manifest = saved["manifest"].clone();
        manifest["nodes"].as_object_mut().unwrap().remove("canvas");
        save_manifest(&engine, manifest).await;
        interrupt.store(true, Ordering::SeqCst);
        assert!(
            engine
                .cycle(drive_source(), &server.endpoints)
                .await
                .is_err(),
            "{failure}"
        );
        let reader_directory = TestDirectory::new();
        let reader = reader_directory.engine(true);
        reader
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        if failure == "manifest" {
            assert_eq!(read(&reader, "canvas").await, b"saved picture");
        } else {
            assert!(reader.store.lock().unwrap().manifest["nodes"]["canvas"].is_null());
        }
        if failure == "delete-changed" {
            let mut remote = state.lock().unwrap();
            let file = remote
                .files
                .iter_mut()
                .find(|file| file.id == "canvas-entry")
                .unwrap();
            file.bytes = b"another device's edit".to_vec();
            file.revision = "concurrent-revision".into();
        }
        drop(engine);
        let reopened = directory.engine(true);
        if failure == "delete-restored" {
            seed(&reopened, "canvas", "png", b"saved picture".to_vec()).await;
        } else if failure.starts_with("delete-restored-yjs") {
            seed(&reopened, "canvas", "mcanvas", fixture_bytes("baseUpdate")).await;
            update(&reopened, "localUpdate", "local").await;
        }
        if failure == "delete-restored-yjs-upload-response"
            || failure == "delete-restored-yjs-changed"
        {
            media_interrupt.store(true, Ordering::SeqCst);
            assert!(reopened
                .cycle(drive_source(), &server.endpoints)
                .await
                .is_err());
            update(&reopened, "remoteUpdate", "local").await;
            if failure == "delete-restored-yjs-changed" {
                let mut remote = state.lock().unwrap();
                let file = remote
                    .files
                    .iter_mut()
                    .find(|file| file.id == "canvas-entry")
                    .unwrap();
                file.bytes = b"another device's edit".to_vec();
                file.revision = "concurrent-revision".into();
            }
        }
        if failure == "delete-restored-yjs-changed" {
            assert!(reopened
                .cycle(drive_source(), &server.endpoints)
                .await
                .err()
                .unwrap()
                .contains("file changed"));
            assert!(!reopened.store.lock().unwrap().outbox.is_empty());
            assert_eq!(
                state
                    .lock()
                    .unwrap()
                    .files
                    .iter()
                    .find(|file| file.id == "canvas-entry")
                    .unwrap()
                    .bytes,
                b"another device's edit"
            );
            continue;
        }
        reopened
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        assert!(reopened.store.lock().unwrap().outbox.is_empty());
        let remote = state.lock().unwrap();
        let file = remote.files.iter().find(|file| file.id == "canvas-entry");
        match failure {
            "delete-changed" => assert_eq!(file.unwrap().bytes, b"another device's edit"),
            "delete-restored" | "delete-restored-yjs" | "delete-restored-yjs-upload-response" => {
                if failure.starts_with("delete-restored-yjs") {
                    let doc = document::decode(&file.unwrap().bytes).unwrap();
                    let txn = doc.transact();
                    assert_eq!(
                        txn.get_text("content").unwrap().get_string(&txn),
                        if failure == "delete-restored-yjs-upload-response" {
                            "remote seed local"
                        } else {
                            "seed local"
                        }
                    );
                }
                assert!(file.is_some());
                let manifest = remote.manifest();
                assert!(manifest["nodes"]["canvas"].is_object());
            }
            _ => assert!(file.is_none(), "{failure}"),
        }
        assert!(!reopened
            .cache_dir
            .join(format!(
                ".drive-deletions-{}.json",
                store::revision(b"folder-1")
            ))
            .exists());
    }
}

#[path = "metadata_tests.rs"]
mod metadata_tests;

#[cfg(unix)]
#[tokio::test]
async fn native_github_sync_does_not_read_unchanged_document_contents() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let mut manifest = manifest_with("canvas", "mcanvas");
    manifest["nodes"]["picture"] = node("picture", "png");
    let picture = vec![42; 1024 * 1024];
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        manifest,
        HashMap::from([
            ("canvas".into(), fixture_bytes("baseUpdate")),
            ("picture".into(), picture.clone()),
        ]),
    )));
    let remote = state.clone();
    let server = TestServer::new(move |request| remote.lock().unwrap().handle(request)).await;
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    let basis_root = engine
        .cache_dir
        .join("repository-bases")
        .join(store::revision(engine.id.as_bytes()));
    let basis = basis_root.join(engine.store.lock().unwrap().sync.basis_id.as_ref().unwrap());
    let path = basis.join("files/picture.png");
    let inode = fs::metadata(&path).unwrap().ino();
    let permissions = fs::metadata(&path).unwrap().permissions();
    // An unchanged document must survive sync without opening its contents.
    fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
    assert!(fs::read(&path).is_err());

    update(&engine, "localUpdate", "local").await;
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert!(engine.store.lock().unwrap().outbox.is_empty());
    {
        let mut remote = state.lock().unwrap();
        let bytes =
            document::merge(&remote.files["canvas"], &fixture_bytes("remoteUpdate")).unwrap();
        remote.files.insert("canvas".into(), bytes);
        remote.head = "d".repeat(40);
    }
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    let doc = document::decode(&read(&engine, "canvas").await).unwrap();
    assert_eq!(
        doc.transact()
            .get_text("content")
            .unwrap()
            .get_string(&doc.transact()),
        fixture()["expected"]["content"].as_str().unwrap()
    );
    let basis = basis_root.join(engine.store.lock().unwrap().sync.basis_id.as_ref().unwrap());
    let path = basis.join("files/picture.png");
    assert_eq!(fs::metadata(&path).unwrap().ino(), inode);
    fs::set_permissions(&path, permissions).unwrap();
    assert_eq!(fs::read(path).unwrap(), picture);
    assert_eq!(read(&engine, "picture").await, picture);
}

#[tokio::test]
async fn sync_diagnostics_include_recovered_http_retries() {
    let requests = Arc::new(AtomicUsize::new(0));
    let seen = requests.clone();
    let server = TestServer::new(move |_| {
        if seen.fetch_add(1, Ordering::SeqCst) == 0 {
            (500, Vec::new())
        } else {
            (200, b"{}".to_vec())
        }
    })
    .await;
    let client =
        crate::repository_bootstrap::download::RemoteClient::new("secret-token".into(), false)
            .unwrap();
    let trace = telemetry::SyncTrace::new();
    trace
        .scope(client.json(
            "Test request",
            tauri_plugin_http::reqwest::Method::GET,
            server.endpoints.drive.parse().unwrap(),
            None,
        ))
        .await
        .unwrap();
    let fields = trace.fields();
    assert_eq!(fields["http_request_count"], 2);
    assert_eq!(fields["http_retry_count"], 1);
    assert_eq!(fields["http_last_retry_status"], 500);
    assert_eq!(fields["http_error_count"], 1);
    assert_eq!(fields["http_last_error_status"], 500);
    assert!(fields["http_retry_wait_ms"].as_u64().unwrap() >= 500);
    assert!(!serde_json::to_string(&fields)
        .unwrap()
        .contains("secret-token"));
}

#[tokio::test]
async fn initial_sync_installs_files_before_a_metadata_only_recovery_journal() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let mut manifest = manifest_with("canvas", "mcanvas");
    manifest["nodes"]["picture"] = node("picture", "png");
    let canvas = fixture_bytes("baseUpdate");
    let picture = vec![42; 1024 * 1024];
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        manifest,
        HashMap::from([
            ("canvas".into(), canvas.clone()),
            ("picture".into(), picture.clone()),
        ]),
    )));
    let server = TestServer::new(move |request| state.lock().unwrap().handle(request)).await;
    let root = directory.0.join("data");
    let blocked_file = root.join("files/picture.png");
    fs::create_dir(&blocked_file).unwrap();
    assert!(engine
        .cycle(github_source(), &server.endpoints)
        .await
        .is_err());
    assert!(engine.store.lock().unwrap().manifest["nodes"]
        .as_object()
        .unwrap()
        .is_empty());
    assert!(!root.join(".native-journal.json").exists());
    fs::remove_dir(blocked_file).unwrap();
    let blocked = root.join(".repository.json.native.tmp");
    fs::create_dir(&blocked).unwrap();
    assert!(engine
        .cycle(github_source(), &server.endpoints)
        .await
        .is_err());
    let journal = fs::read(root.join(".native-journal.json")).unwrap();
    let saved: Value = serde_json::from_slice(&journal).unwrap();
    assert_eq!(saved["files"], json!([]));
    assert!(journal.len() < 16 * 1024);
    assert_eq!(fs::read(root.join("files/picture.png")).unwrap(), picture);
    assert_eq!(fs::read(root.join("files/canvas.myelin")).unwrap(), canvas);
    let basis = engine
        .cache_dir
        .join("repository-bases")
        .join(store::revision(engine.id.as_bytes()));
    let cached = fs::read_dir(basis).unwrap().next().unwrap().unwrap().path();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        assert_eq!(
            fs::metadata(root.join("files/picture.png")).unwrap().ino(),
            fs::metadata(cached.join("files/picture.png"))
                .unwrap()
                .ino()
        );
    }
    fs::remove_dir(blocked).unwrap();
    drop(engine);
    let reopened = directory.engine(true);
    assert_eq!(read(&reopened, "picture").await, picture);
    assert_eq!(read(&reopened, "canvas").await, canvas);
    assert!(!root.join(".native-journal.json").exists());
    assert!(reopened.store.lock().unwrap().outbox.is_empty());
    seed(&reopened, "picture", "png", b"edited".to_vec()).await;
    assert_eq!(fs::read(cached.join("files/picture.png")).unwrap(), picture);
}
