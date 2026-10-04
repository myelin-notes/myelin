use super::*;
use crate::{repository_metadata as metadata, repository_metadata::legacy::parse_manifest};

#[test]
fn migration_replays_legacy_journals_and_resumes_before_switching_formats() {
    let directory = TestDirectory::new();
    let root = directory.0.join("data");
    fs::create_dir_all(root.join("files")).unwrap();
    let mut legacy = manifest_with("canvas", "mcanvas");
    legacy["version"] = json!(1);
    legacy["customColors"] = json!(["#123456"]);
    legacy["nodes"]["folder"] = json!({"id":"folder","type":"folder","name":"Saved folder","parentId":null,"tags":["work"],"createdAt":10,"modifiedAt":20,"color":"#abcdef"});
    legacy["nodes"]["canvas"]["parentId"] = json!("folder");
    legacy["nodes"]["canvas"]["tags"] = json!(["important"]);
    legacy["nodes"]["picture"] = node("picture", "png");
    legacy["nodes"]["version"] = node("version", "png");
    legacy["nodes"]["version"]["system"] = json!({"kind":"file-version","sourceFileId":"picture","sourceFileType":"png","sourceName":"picture.png","sourceRevision":"r1","capturedAt":100,"byteLength":5});
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&legacy).unwrap(),
    )
    .unwrap();
    legacy["nodes"]["canvas"]["name"] = json!("Journal rename");
    let journal = json!({"manifest":legacy,"outbox":[{"kind":"upsert-manifest-node","nodeId":"canvas","queueRevision":"pending"}],"sync":{},"files":[{"name":"canvas.myelin","bytes":STANDARD.encode(fixture_bytes("baseUpdate"))},{"name":"picture.png","bytes":STANDARD.encode(b"image")},{"name":"version.png","bytes":STANDARD.encode(b"older")}],"updates":[{"node_id":"canvas","id":"pending-update","bytes":fixture()["localUpdate"]}]});
    fs::write(
        root.join(".native-journal.json"),
        serde_json::to_vec(&journal).unwrap(),
    )
    .unwrap();
    let obstruction = root.join("files/.picture.meta.json.native.tmp");
    fs::create_dir(&obstruction).unwrap();
    assert!(Store::open(root.clone(), true).is_err());
    assert_eq!(
        parse_manifest(&fs::read(root.join("manifest.json")).unwrap()).unwrap()["nodes"]["canvas"]
            ["name"],
        "Journal rename"
    );
    assert!(root.join(".native-journal.json").exists());
    let backup = fs::read(root.join(metadata::BACKUP)).unwrap();
    assert_eq!(serde_json::from_slice::<Value>(&backup).unwrap(), legacy);
    fs::remove_dir(obstruction).unwrap();
    let mut migrated = Store::open(root.clone(), true).unwrap();
    assert!(parse_manifest(&fs::read(root.join("manifest.json")).unwrap()).is_err());
    assert_eq!(migrated.manifest["nodes"]["canvas"]["parentId"], "folder");
    assert_eq!(
        migrated.manifest["nodes"]["canvas"]["tags"],
        json!(["important"])
    );
    assert_eq!(migrated.manifest["nodes"]["folder"]["color"], "#abcdef");
    assert_eq!(migrated.manifest["colors"]["pen"], json!(["#123456"]));
    assert_eq!(
        migrated.manifest["nodes"]["version"]["system"]["capturedAt"],
        100
    );
    assert_eq!(migrated.outbox[0]["queueRevision"], "pending");
    let doc = document::decode(
        &migrated
            .read_file(&migrated.manifest["nodes"]["canvas"])
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        doc.transact()
            .get_text("content")
            .unwrap()
            .get_string(&doc.transact()),
        "seed local"
    );
    assert_eq!(
        migrated
            .read_file(&migrated.manifest["nodes"]["picture"])
            .unwrap(),
        b"image"
    );
    let record: Value =
        serde_json::from_slice(&fs::read(root.join("files/canvas.meta.json")).unwrap()).unwrap();
    assert_eq!(record["version"], 1);
    assert_eq!(record["node"]["name"], "Journal rename");
    assert!(record["links"].is_array());
    migrated.manifest["nodes"]["canvas"]["name"] = json!("Later rename");
    migrated.mark_node("canvas");
    migrated.commit(vec![]).unwrap();
    drop(migrated);
    assert_eq!(
        Store::open(root.clone(), true).unwrap().manifest["nodes"]["canvas"]["name"],
        "Later rename"
    );
    assert_eq!(fs::read(root.join(metadata::BACKUP)).unwrap(), backup);
}

#[tokio::test]
async fn note_updates_journal_only_changed_metadata_and_leave_other_records_untouched() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "canvas", "mcanvas", fixture_bytes("baseUpdate")).await;
    seed(&engine, "picture", "png", b"image".to_vec()).await;
    let root = directory.0.join("data");
    let untouched: Vec<_> = [
        "files/picture.meta.json",
        "repository.json",
        "manifest.json",
    ]
    .into_iter()
    .map(|name| {
        let path = root.join(name);
        (
            path.clone(),
            fs::read(&path).unwrap(),
            fs::metadata(&path).unwrap().modified().unwrap(),
        )
    })
    .collect();
    let obstruction = root.join("files/.canvas.meta.json.native.tmp");
    fs::create_dir(&obstruction).unwrap();
    assert!(engine
        .operate(RepositoryOperation::UpdateDocument {
            node_id: "canvas".into(),
            update_base64: fixture()["localUpdate"].as_str().unwrap().into(),
            origin: "local".into(),
            generation: None,
            source_session: None
        })
        .await
        .is_err());
    let journal: Value =
        serde_json::from_slice(&fs::read(root.join(".native-journal.json")).unwrap()).unwrap();
    assert!(journal.get("manifest").is_none());
    assert!(journal.get("sync").is_none());
    let writes = journal["metadata"].as_array().unwrap();
    assert_eq!(writes.len(), 1);
    assert_eq!(writes[0]["name"], "files/canvas.meta.json");
    fs::remove_dir(obstruction).unwrap();
    drop(engine);
    let reopened = directory.engine(true);
    let doc = document::decode(&read(&reopened, "canvas").await).unwrap();
    assert_eq!(
        doc.transact()
            .get_text("content")
            .unwrap()
            .get_string(&doc.transact()),
        "seed local"
    );
    for (path, bytes, modified) in untouched {
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::metadata(path).unwrap().modified().unwrap(), modified);
    }
}

#[tokio::test]
async fn corruption_is_isolated_and_a_lost_marker_does_not_lose_the_library() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "canvas", "mcanvas", fixture_bytes("baseUpdate")).await;
    seed(&engine, "picture", "png", b"image".to_vec()).await;
    let root = directory.0.join("data");
    drop(engine);
    fs::write(root.join("manifest.json"), b"corrupt marker").unwrap();
    let reopened = directory.engine(true);
    assert_eq!(read(&reopened, "picture").await, b"image");
    assert!(reopened.store.lock().unwrap().recovery_error.is_none());
    drop(reopened);
    fs::write(root.join("files/canvas.meta.json"), b"corrupt node").unwrap();
    fs::write(root.join("repository.json"), b"corrupt settings").unwrap();
    let reopened = directory.engine(true);
    assert_eq!(read(&reopened, "picture").await, b"image");
    assert!(reopened.store.lock().unwrap().manifest["nodes"]["canvas"].is_null());
    assert!(reopened.store.lock().unwrap().recovery_error.is_some());
    assert!(root.join("files/canvas.myelin").exists());
    let quarantined: Vec<_> = fs::read_dir(&root)
        .unwrap()
        .filter_map(|entry| {
            let entry = entry.unwrap();
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("metadata.corrupt.")
                .then(|| fs::read(entry.path()).unwrap())
        })
        .collect();
    assert!(quarantined.contains(&b"corrupt node".to_vec()));
    assert!(quarantined.contains(&b"corrupt settings".to_vec()));
    drop(reopened);
    fs::remove_file(root.join("repository.json")).unwrap();
    let reopened = directory.engine(true);
    assert_eq!(read(&reopened, "picture").await, b"image");
    assert!(reopened.store.lock().unwrap().recovery_error.is_some());
}

#[tokio::test]
async fn github_migrates_without_local_edits_and_then_uploads_only_the_changed_sidecar() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let mut legacy = manifest_with("first", "png");
    legacy["nodes"]["second"] = node("second", "png");
    let backup = serde_json::to_vec(&legacy).unwrap();
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        legacy,
        HashMap::from([
            ("first".into(), b"first".to_vec()),
            ("second".into(), b"second".to_vec()),
        ]),
    )));
    let remote = state.clone();
    let server = TestServer::new(move |request| remote.lock().unwrap().handle(request)).await;
    state.lock().unwrap().fail_blob = true;
    assert!(engine
        .cycle(github_source(), &server.endpoints)
        .await
        .is_err());
    assert!(!state.lock().unwrap().sidecars);
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert_eq!(state.lock().unwrap().backup.as_ref().unwrap(), &backup);
    assert!(state.lock().unwrap().sidecars);
    assert_eq!(read(&engine, "second").await, b"second");
    #[cfg(unix)]
    let original_sidecar = {
        use std::os::unix::fs::MetadataExt;
        let basis = engine.store.lock().unwrap().sync.basis_id.clone().unwrap();
        fs::metadata(
            engine
                .cache_dir
                .join("repository-bases")
                .join(revision(engine.id.as_bytes()))
                .join(basis)
                .join("files/second.meta.json"),
        )
        .unwrap()
        .ino()
    };
    let (saved, _) = engine.operate(RepositoryOperation::Manifest).await.unwrap();
    let mut manifest = saved["manifest"].clone();
    manifest["nodes"]["first"]["name"] = json!("Renamed");
    save_manifest(&engine, manifest).await;
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    let remote = state.lock().unwrap();
    let paths: Vec<_> = remote
        .tree
        .iter()
        .map(|entry| entry["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths.len(), 2);
    assert!(paths.contains(&"files/first.meta.json"));
    assert!(paths.contains(&"repository.json"));
    assert_eq!(remote.manifest["nodes"]["first"]["name"], "Renamed");
    assert_eq!(remote.backup.as_ref().unwrap(), &backup);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let basis = engine.store.lock().unwrap().sync.basis_id.clone().unwrap();
        assert_eq!(
            fs::metadata(
                engine
                    .cache_dir
                    .join("repository-bases")
                    .join(revision(engine.id.as_bytes()))
                    .join(basis)
                    .join("files/second.meta.json")
            )
            .unwrap()
            .ino(),
            original_sidecar
        );
    }
}

#[tokio::test]
async fn drive_migration_resumes_staged_records_and_an_ambiguous_final_marker() {
    for failure in ["sidecar", "settings", "marker-response", "legacy-delete"] {
        let directory = TestDirectory::new();
        let engine = directory.engine(true);
        let state = Arc::new(Mutex::new(DriveFixture::new()));
        let backup = state.lock().unwrap().files[0].bytes.clone();
        let remote = state.clone();
        let trigger = Arc::new(AtomicBool::new(true));
        let server = TestServer::new(move |request| {
            let matches = match failure {
                "sidecar" => {
                    request.method == "POST"
                        && String::from_utf8_lossy(&request.body).contains("canvas.meta.json")
                }
                "settings" | "legacy-delete" => {
                    request.method == "POST"
                        && String::from_utf8_lossy(&request.body).contains("repository.json")
                }
                _ => {
                    request.method == "PATCH"
                        && request.path.starts_with("/upload/files/manifest-entry")
                }
            };
            if matches && trigger.swap(false, Ordering::SeqCst) {
                if failure == "marker-response" {
                    remote.lock().unwrap().handle(request);
                }
                return (400, b"interrupted migration".to_vec());
            }
            remote.lock().unwrap().handle(request)
        })
        .await;
        assert!(engine
            .cycle(drive_source(), &server.endpoints)
            .await
            .is_err());
        if failure != "marker-response" {
            assert_eq!(
                state
                    .lock()
                    .unwrap()
                    .files
                    .iter()
                    .find(|file| file.id == "manifest-entry")
                    .unwrap()
                    .bytes,
                backup
            );
        }
        if failure == "legacy-delete" {
            let mut remote = state.lock().unwrap();
            let manifest = remote
                .files
                .iter_mut()
                .find(|file| file.id == "manifest-entry")
                .unwrap();
            manifest.bytes =
                serde_json::to_vec(&crate::repository_metadata::empty_manifest()).unwrap();
            manifest.revision = "legacy-deleted".into();
            remote.files.retain(|file| file.id != "canvas-entry");
        }
        drop(engine);
        let reopened = directory.engine(true);
        reopened
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        if failure == "legacy-delete" {
            assert!(reopened.store.lock().unwrap().manifest["nodes"]["canvas"].is_null());
        } else {
            let document = document::decode(&read(&reopened, "canvas").await).unwrap();
            assert_eq!(
                document
                    .transact()
                    .get_text("content")
                    .unwrap()
                    .get_string(&document.transact()),
                "seed"
            );
        }
        let remote = state.lock().unwrap();
        assert!(parse_manifest(
            &remote
                .files
                .iter()
                .find(|file| file.name == "manifest.json")
                .unwrap()
                .bytes
        )
        .is_err());
        assert_eq!(
            remote
                .files
                .iter()
                .find(|file| file.name == "manifest.legacy.json")
                .unwrap()
                .bytes,
            backup
        );
        assert_eq!(
            remote
                .files
                .iter()
                .filter(|file| file.name == "canvas.meta.json")
                .count(),
            1
        );
    }
}

#[tokio::test]
async fn stale_offline_edits_keep_a_recovery_copy_without_resurrecting_a_deleted_id() {
    let first_directory = TestDirectory::new();
    let second_directory = TestDirectory::new();
    let first = first_directory.engine(true);
    let second = second_directory.engine(true);
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        manifest_with("picture", "png"),
        HashMap::from([("picture".into(), b"original".to_vec())]),
    )));
    let remote = state.clone();
    let server = TestServer::new(move |request| remote.lock().unwrap().handle(request)).await;
    first
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    second
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    let (saved, _) = first.operate(RepositoryOperation::Manifest).await.unwrap();
    let mut manifest = saved["manifest"].clone();
    manifest["nodes"].as_object_mut().unwrap().remove("picture");
    save_manifest(&first, manifest).await;
    first
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    second
        .operate(RepositoryOperation::WriteFile {
            node: node("picture", "png"),
            bytes_base64: STANDARD.encode(b"offline edit"),
            replace: true,
            overwrite_remote: false,
        })
        .await
        .unwrap();
    server.pause_blob.store(true, Ordering::SeqCst);
    let syncing = second.clone();
    let endpoints = server.endpoints.clone();
    let task = tokio::spawn(async move { syncing.cycle(github_source(), &endpoints).await });
    tokio::time::timeout(std::time::Duration::from_secs(3), server.paused.notified())
        .await
        .unwrap();
    second
        .operate(RepositoryOperation::WriteFile {
            node: node("picture", "png"),
            bytes_base64: STANDARD.encode(b"newer offline edit"),
            replace: true,
            overwrite_remote: false,
        })
        .await
        .unwrap();
    server.resume.notify_one();
    task.await.unwrap().unwrap();
    let recovery_id = second.store.lock().unwrap().manifest["nodes"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    assert_eq!(read(&second, &recovery_id).await, b"newer offline edit");
    assert!(!second.store.lock().unwrap().outbox.is_empty());
    second
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    let remote = state.lock().unwrap();
    assert!(remote.manifest["nodes"]["picture"].is_null());
    assert!(!remote.files.contains_key("picture"));
    assert!(remote.manifest["deletedNodes"]["picture"].is_string());
    let recovered = remote.manifest["nodes"]
        .as_object()
        .unwrap()
        .iter()
        .find(|(_, node)| {
            node["name"]
                .as_str()
                .unwrap()
                .contains("Recovered deleted file")
        })
        .unwrap();
    assert_eq!(remote.files[recovered.0], b"newer offline edit");
    assert!(second.store.lock().unwrap().outbox.is_empty());
}

#[tokio::test]
async fn cloud_corruption_keeps_cached_content_and_imports_healthy_records_without_uploading() {
    for missing in [false, true] {
        let directory = TestDirectory::new();
        let engine = directory.engine(true);
        let state = Arc::new(Mutex::new(DriveFixture::new()));
        let remote = state.clone();
        let server = TestServer::new(move |request| remote.lock().unwrap().handle(request)).await;
        engine
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        seed(&engine, "picture", "png", b"healthy image".to_vec()).await;
        engine
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        {
            let mut remote = state.lock().unwrap();
            let settings = remote
                .files
                .iter_mut()
                .find(|file| file.name == "repository.json")
                .unwrap();
            settings.bytes = b"corrupt settings".to_vec();
            settings.revision = "corrupt-settings".into();
            if missing {
                remote.files.retain(|file| file.name != "canvas.meta.json");
            } else {
                let record = remote
                    .files
                    .iter_mut()
                    .find(|file| file.name == "canvas.meta.json")
                    .unwrap();
                record.bytes = b"corrupt metadata".to_vec();
                record.revision = "corrupt-metadata".into();
            }
        }
        let before = server.requests.lock().unwrap().len();
        engine
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        assert_eq!(read(&engine, "picture").await, b"healthy image");
        let document = document::decode(&read(&engine, "canvas").await).unwrap();
        assert_eq!(
            document
                .transact()
                .get_text("content")
                .unwrap()
                .get_string(&document.transact()),
            "seed"
        );
        assert!(engine
            .status()
            .await
            .last_error
            .unwrap()
            .contains("requires recovery"));
        let fresh_directory = TestDirectory::new();
        let fresh = fresh_directory.engine(true);
        fresh
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        assert_eq!(read(&fresh, "picture").await, b"healthy image");
        assert!(fresh.store.lock().unwrap().recovery_error.is_some());
        assert!(server.requests.lock().unwrap()[before..]
            .iter()
            .all(|request| request.method == "GET"));
        assert!(state
            .lock()
            .unwrap()
            .files
            .iter()
            .any(|file| file.name == "canvas.myelin"));
    }
}

#[tokio::test]
async fn cloud_upgrade_markers_are_rebuilt_from_sidecars_when_missing_or_corrupt() {
    for missing in [false, true] {
        let directory = TestDirectory::new();
        let engine = directory.engine(true);
        let state = Arc::new(Mutex::new(DriveFixture::new()));
        let remote = state.clone();
        let server = TestServer::new(move |request| remote.lock().unwrap().handle(request)).await;
        engine
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        let backup = state
            .lock()
            .unwrap()
            .files
            .iter()
            .find(|file| file.name == "manifest.legacy.json")
            .unwrap()
            .bytes
            .clone();
        {
            let mut remote = state.lock().unwrap();
            if missing {
                remote.files.retain(|file| file.name != "manifest.json");
            } else {
                let marker = remote
                    .files
                    .iter_mut()
                    .find(|file| file.name == "manifest.json")
                    .unwrap();
                marker.bytes = b"corrupt upgrade marker".to_vec();
                marker.revision = "corrupt-marker".into();
            }
        }
        let fresh_directory = TestDirectory::new();
        let fresh = fresh_directory.engine(true);
        fresh
            .cycle(drive_source(), &server.endpoints)
            .await
            .unwrap();
        assert_eq!(
            fresh.store.lock().unwrap().manifest["nodes"]["canvas"]["name"],
            "canvas.mcanvas"
        );
        assert!(fresh.store.lock().unwrap().recovery_error.is_none());
        let remote = state.lock().unwrap();
        assert!(metadata::is_marker(
            &remote
                .files
                .iter()
                .find(|file| file.name == "manifest.json")
                .unwrap()
                .bytes
        ));
        assert_eq!(
            remote
                .files
                .iter()
                .find(|file| file.name == "manifest.legacy.json")
                .unwrap()
                .bytes,
            backup
        );
    }
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        manifest_with("picture", "png"),
        HashMap::from([("picture".into(), b"image".to_vec())]),
    )));
    let remote = state.clone();
    let omit_marker = Arc::new(AtomicBool::new(false));
    let omit = omit_marker.clone();
    let server = TestServer::new(move |request| {
        if omit.load(Ordering::SeqCst) && request.path.contains("/tarball/") {
            let mut files = remote.lock().unwrap().repository_files();
            files.remove("manifest.json");
            return (200, archive(files));
        }
        remote.lock().unwrap().handle(request)
    })
    .await;
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    omit_marker.store(true, Ordering::SeqCst);
    let fresh_directory = TestDirectory::new();
    let fresh = fresh_directory.engine(true);
    fresh
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert_eq!(read(&fresh, "picture").await, b"image");
    assert!(fresh.store.lock().unwrap().recovery_error.is_none());
}

#[test]
fn legacy_preferences_are_normalized_during_automatic_open() {
    let directory = TestDirectory::new();
    let root = directory.0.join("data");
    fs::create_dir_all(&root).unwrap();
    let mut legacy = metadata::empty_manifest();
    legacy["version"] = json!(2);
    legacy["customColors"] = json!([
        "#000000", "#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777",
        "#888888"
    ]);
    legacy["penPresets"] = json!([
        {"id":"invalid-tool","tool":"eraser","color":"#abcdef","size":4},
        {"id":"invalid-color","tool":"pen","color":"invalid","size":4},
        {"id":"pen","tool":"pen","color":"ABCDEF","size":9999,"inWheel":true},
        {"id":"highlight","tool":"highlighter","color":"#facc15","size":1},
        {"id":"three","tool":"pen","color":"#abcdef","size":8},
        {"id":"four","tool":"pen","color":"#abcdef","size":8},
        {"id":"five","tool":"pen","color":"#abcdef","size":8},
        {"id":"six","tool":"pen","color":"#abcdef","size":8},
        {"id":"over-cap","tool":"pen","color":"#abcdef","size":8}
    ]);
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&legacy).unwrap(),
    )
    .unwrap();
    let loaded = Store::open(root, false).unwrap();
    assert_eq!(
        loaded.manifest["colors"]["pen"],
        json!([
            "#000000", "#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777"
        ])
    );
    let presets = loaded.manifest["penPresets"].as_array().unwrap();
    assert_eq!(presets.len(), 6);
    assert_eq!(
        presets[0],
        json!({"id":"pen","tool":"pen","color":"#abcdef","size":40.0,"inWheel":true})
    );
    assert_eq!(
        presets[1],
        json!({"id":"highlight","tool":"highlighter","color":"#facc15","size":12.0,"inWheel":false})
    );
    assert_eq!(presets[5]["id"], "six");
}

#[tokio::test]
async fn fresh_cloud_repositories_publish_sidecars_without_a_legacy_manifest() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "image", "png", b"image".to_vec()).await;
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        metadata::empty_manifest(),
        HashMap::new(),
    )));
    let remote = state.clone();
    let server = TestServer::new(move |request| {
        let mut state = remote.lock().unwrap();
        if request.path.contains("/tarball/") && !state.sidecars {
            return (200, archive(HashMap::new()));
        }
        state.handle(request)
    })
    .await;
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
    assert!(state.lock().unwrap().sidecars);
    assert!(state.lock().unwrap().backup.is_none());
    assert_eq!(state.lock().unwrap().files["image"], b"image");

    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "image", "png", b"image".to_vec()).await;
    let mut fixture = DriveFixture::new();
    fixture.files.retain(|file| file.name == "files");
    let state = Arc::new(Mutex::new(fixture));
    let remote = state.clone();
    let server = TestServer::new(move |request| remote.lock().unwrap().handle(request)).await;
    engine
        .cycle(drive_source(), &server.endpoints)
        .await
        .unwrap();
    let remote = state.lock().unwrap();
    assert!(remote
        .files
        .iter()
        .any(|file| file.name == "image.meta.json"));
    assert!(remote
        .files
        .iter()
        .any(|file| file.name == "repository.json"));
    assert!(!remote
        .files
        .iter()
        .any(|file| file.name == metadata::BACKUP));
    assert!(remote
        .files
        .iter()
        .any(|file| file.name == "manifest.json" && metadata::is_marker(&file.bytes)));
    assert_eq!(
        remote
            .files
            .iter()
            .find(|file| file.name == "image.png")
            .unwrap()
            .bytes,
        b"image"
    );
}
