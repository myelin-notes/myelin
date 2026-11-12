use super::*;
use crate::repository_metadata as metadata;

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
    assert!(untyped(&reopened.store.lock().unwrap().manifest)["nodes"]["canvas"].is_null());
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
            node: file("picture", "png"),
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
            node: file("picture", "png"),
            bytes_base64: STANDARD.encode(b"newer offline edit"),
            replace: true,
            overwrite_remote: false,
        })
        .await
        .unwrap();
    server.resume.notify_one();
    task.await.unwrap().unwrap();
    let recovery_id = untyped(&second.store.lock().unwrap().manifest)["nodes"]
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
            untyped(&fresh.store.lock().unwrap().manifest)["nodes"]["canvas"]["name"],
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

#[tokio::test]
async fn fresh_cloud_repositories_publish_sidecars_without_a_legacy_manifest() {
    let directory = TestDirectory::new();
    let engine = directory.engine(true);
    seed(&engine, "image", "png", b"image".to_vec()).await;
    let state = Arc::new(Mutex::new(GitHubFixture::new(
        untyped(&metadata::empty_manifest()),
        HashMap::new(),
    )));
    let remote = state.clone();
    let server = TestServer::new(move |request| {
        let mut state = remote.lock().unwrap();
        if request.path.contains("/tarball/") && state.head == "a".repeat(40) {
            return (200, archive(HashMap::new()));
        }
        state.handle(request)
    })
    .await;
    engine
        .cycle(github_source(), &server.endpoints)
        .await
        .unwrap();
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
