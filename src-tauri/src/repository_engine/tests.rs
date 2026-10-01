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
            open_notes: Mutex::new(HashMap::new()),
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

async fn save_manifest(engine: &RepositoryEngine, manifest: Value) {
    let (saved, _) = engine.operate(RepositoryOperation::Manifest).await.unwrap();
    engine
        .operate(RepositoryOperation::SaveManifest {
            manifest,
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
    engine
        .operate(RepositoryOperation::WriteFile {
            node: file.clone(),
            bytes_base64: links["update"].as_str().unwrap().into(),
            replace: true,
            overwrite_remote: false,
        })
        .await
        .unwrap();
    let mut manifest = crate::repository_bootstrap::download::empty_manifest();
    manifest["nodes"]["canvas"] = file.clone();
    save_manifest(&engine, manifest).await;
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
        .operate(RepositoryOperation::SaveManifest {
            manifest: crate::repository_bootstrap::download::empty_manifest(),
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

fn archive(manifest: &Value, files: &HashMap<String, Vec<u8>>) -> Vec<u8> {
    let mut archive = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    ));
    let mut entries = vec![(
        "root/manifest.json".to_owned(),
        serde_json::to_vec(manifest).unwrap(),
    )];
    for (id, bytes) in files {
        entries.push((
            format!("root/files/{}", file_name(&manifest["nodes"][id]).unwrap()),
            bytes.clone(),
        ));
    }
    for (path, bytes) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        archive
            .append_data(&mut header, path, bytes.as_slice())
            .unwrap();
    }
    archive.into_inner().unwrap().finish().unwrap()
}

struct GitHubFixture {
    manifest: Value,
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
    fn handle(&mut self, request: &Request) -> (u16, Vec<u8>) {
        let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
        let reply = |value: Value| (200, serde_json::to_vec(&value).unwrap());
        if request.path.contains("/branches/") {
            return reply(json!({"commit": {"sha": self.head}}));
        }
        if request.path.contains("/tarball/") {
            return (200, archive(&self.manifest, &self.files));
        }
        if request.method == "GET" && request.path.contains("/git/commits/") {
            return reply(json!({"tree": {"sha": "b".repeat(40)}}));
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
            for item in &self.tree {
                let path = item["path"].as_str().unwrap();
                if path == "manifest.json" {
                    self.manifest =
                        serde_json::from_slice(&self.blobs[item["sha"].as_str().unwrap()]).unwrap();
                    continue;
                }
                let file = path.strip_prefix("files/").unwrap();
                let id = file.rsplit_once('.').unwrap().0;
                if item["sha"].is_null() {
                    self.files.remove(id);
                } else {
                    self.files
                        .insert(id.into(), self.blobs[item["sha"].as_str().unwrap()].clone());
                }
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
                    bytes: serde_json::to_vec(&manifest_with("canvas", "mcanvas")).unwrap(),
                },
                DriveFile {
                    id: "files-folder".into(),
                    parent: "folder-1".into(),
                    name: "files".into(),
                    revision: "folder-r1".into(),
                    bytes: Vec::new(),
                },
                DriveFile {
                    id: "canvas-entry".into(),
                    parent: "files-folder".into(),
                    name: "canvas.myelin".into(),
                    revision: "canvas-r1".into(),
                    bytes: fixture_bytes("baseUpdate"),
                },
            ],
            counter: 1,
            fail_upload: false,
        }
    }
    fn metadata(file: &DriveFile) -> Value {
        json!({"id": file.id, "name": file.name, "headRevisionId": file.revision})
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
        if request.method == "POST" && url.path() == "/drive/files" {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            self.counter += 1;
            let file = DriveFile {
                id: format!("created-{}", self.counter),
                parent: body["parents"][0].as_str().unwrap().into(),
                name: body["name"].as_str().unwrap().into(),
                revision: format!("create-r{}", self.counter),
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
    let manifest: Value = serde_json::from_slice(
        &remote
            .files
            .iter()
            .find(|file| file.id == "manifest-entry")
            .unwrap()
            .bytes,
    )
    .unwrap();
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
    assert!(uploads.last().unwrap().path.contains("manifest-entry"));
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
    let mut manifest = crate::repository_bootstrap::download::empty_manifest();
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
    assert!(engine
        .cycle(github_source(), &server.endpoints)
        .await
        .is_err());
    assert_eq!(
        engine.store.lock().unwrap().sync.basis_id.as_deref(),
        Some(first_basis.as_str())
    );
    assert!(!engine.store.lock().unwrap().outbox.is_empty());
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
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
