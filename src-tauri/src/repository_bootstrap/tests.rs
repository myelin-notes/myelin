use super::download::{download_repository, RepositorySource};
use super::*;
use std::sync::Mutex;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const ROOT: &str = "repositories/github/test";

struct TestDirectory(PathBuf);
impl TestDirectory {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "myelin-bootstrap-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn cache(&self) -> CachePaths {
        CachePaths::new(&self.0, ROOT).unwrap()
    }
    fn seed_cache(&self) {
        let cache = self.cache().cache;
        fs::create_dir_all(cache.join("files")).unwrap();
        fs::write(cache.join("manifest.json"), br#"{"version":3,"nodes":{}}"#).unwrap();
        fs::write(cache.join("files/old.myelin"), b"offline content").unwrap();
        fs::write(cache.join("outbox.json"), b"[]").unwrap();
        fs::write(cache.join("outbox.json.sync-status.json"), b"123").unwrap();
        fs::write(cache.join("outbox.corrupt.json"), b"recovery content").unwrap();
    }
}
impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct TestServer {
    base: String,
    requests: Arc<Mutex<Vec<String>>>,
    messages: Arc<Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}
impl TestServer {
    async fn new(handler: impl Fn(&str) -> (u16, Vec<u8>) + Send + Sync + 'static) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        let messages = Arc::new(Mutex::new(Vec::new()));
        let recorded_messages = messages.clone();
        let task = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let count = socket.read(&mut buffer).await.unwrap();
                    if count == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                    if bytes.windows(4).any(|part| part == b"\r\n\r\n") {
                        break;
                    }
                }
                let header_end = bytes
                    .windows(4)
                    .position(|part| part == b"\r\n\r\n")
                    .unwrap()
                    + 4;
                let headers = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                while bytes.len() < header_end + content_length {
                    let count = socket.read(&mut buffer).await.unwrap();
                    bytes.extend_from_slice(&buffer[..count]);
                }
                let request = String::from_utf8(bytes).unwrap();
                let path = request
                    .lines()
                    .next()
                    .unwrap()
                    .split_whitespace()
                    .nth(1)
                    .unwrap();
                recorded.lock().unwrap().push(path.to_owned());
                recorded_messages.lock().unwrap().push(request.clone());
                let (status, body) = handler(path);
                let header = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                socket.write_all(header.as_bytes()).await.unwrap();
                socket.write_all(&body).await.unwrap();
            }
        });
        Self {
            base,
            requests,
            messages,
            task,
        }
    }
    fn endpoints(&self) -> download::RemoteEndpoints {
        download::RemoteEndpoints {
            github: format!("{}/github", self.base),
            drive: format!("{}/drive", self.base),
            drive_upload: format!("{}/upload", self.base),
        }
    }
}
impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn manifest() -> serde_json::Value {
    serde_json::json!({
        "version": 3,
        "nodes": {
            "canvas": { "id": "canvas", "type": "file", "fileType": "mcanvas", "name": "Canvas", "parentId": null, "tags": [], "createdAt": 1, "modifiedAt": 1 },
            "version": { "id": "version", "type": "file", "fileType": "pdf", "name": "Snapshot", "parentId": null, "tags": [], "createdAt": 1, "modifiedAt": 1, "system": { "kind": "file-version", "sourceFileId": "canvas", "byteLength": 3 } }
        },
        "linksBySource": { "canvas": [{ "targetId": "version", "type": "link" }] },
        "colors": { "pen": ["#123456"], "highlighter": [], "text": [], "folder": [] },
        "tagRegistry": ["tag"], "penPresets": []
    })
}

fn github_source() -> RepositorySource {
    RepositorySource::Github {
        owner: "owner".into(),
        repo: "repo".into(),
        branch: "feature/notes".into(),
        token: "secret".into(),
    }
}

fn archive(entries: Vec<(&str, Vec<u8>)>) -> Vec<u8> {
    let gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    let mut builder = tar::Builder::new(gzip);
    for (path, bytes) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(
                &mut header,
                format!("owner-repo-revision/{path}"),
                bytes.as_slice(),
            )
            .unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap()
}

async fn github_server(archive: Vec<u8>) -> TestServer {
    TestServer::new(move |path| match path {
        "/github/repos/owner/repo/branches/feature%2Fnotes" => (
            200,
            br#"{"commit":{"sha":"1111111111111111111111111111111111111111"}}"#.to_vec(),
        ),
        "/github/repos/owner/repo/tarball/1111111111111111111111111111111111111111" => {
            (200, archive.clone())
        }
        _ => (404, vec![]),
    })
    .await
}

// Serves the branch, then the tarball in three parts with `pause` between them; `None` stalls after
// the first part.
async fn slow_github_endpoints(pause: Option<std::time::Duration>) -> download::RemoteEndpoints {
    let tarball = archive(vec![
        ("manifest.json", serde_json::to_vec(&manifest()).unwrap()),
        ("files/canvas.myelin", vec![7; 150_000]),
        ("files/version.pdf", b"pdf".to_vec()),
    ]);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let tarball = tarball.clone();
            tokio::spawn(async move {
                let mut buffer = [0; 4096];
                let count = socket.read(&mut buffer).await.unwrap();
                let slow = String::from_utf8_lossy(&buffer[..count]).contains("/tarball/");
                let body = if slow {
                    tarball
                } else {
                    br#"{"commit":{"sha":"1111111111111111111111111111111111111111"}}"#.to_vec()
                };
                let header = format!(
                    "HTTP/1.1 200 Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                socket.write_all(header.as_bytes()).await.unwrap();
                for part in body.chunks(body.len().div_ceil(3)) {
                    socket.write_all(part).await.unwrap();
                    match pause {
                        Some(pause) if slow => tokio::time::sleep(pause).await,
                        None if slow => std::future::pending().await,
                        _ => {}
                    }
                }
            });
        }
    });
    download::RemoteEndpoints {
        github: format!("{base}/github"),
        drive: format!("{base}/drive"),
        drive_upload: format!("{base}/upload"),
    }
}

#[tokio::test]
async fn github_tarball_outlasting_the_stall_timeout_still_downloads() {
    let directory = TestDirectory::new();
    let stage = directory.0.join("download");
    fs::create_dir_all(stage.join("files")).unwrap();
    let endpoints = slow_github_endpoints(Some(std::time::Duration::from_secs(3))).await;
    let prepared = download_repository(&stage, github_source(), &endpoints)
        .await
        .unwrap();
    assert_eq!(prepared, (2, 150_003));
}

#[tokio::test]
async fn github_tarball_that_stalls_fails_instead_of_holding_the_sync() {
    let directory = TestDirectory::new();
    let stage = directory.0.join("download");
    fs::create_dir_all(stage.join("files")).unwrap();
    let endpoints = slow_github_endpoints(None).await;
    let error = download_repository(&stage, github_source(), &endpoints)
        .await
        .err()
        .expect("a stalled tarball must fail");
    assert_eq!(
        error,
        "GitHub tarball download failed while receiving content"
    );
}

#[tokio::test]
async fn github_downloads_one_revision_without_changing_existing_cache() {
    let directory = TestDirectory::new();
    let stage = directory.0.join("download");
    fs::create_dir_all(stage.join("files")).unwrap();
    directory.seed_cache();
    let manifest = manifest();
    let note = vec![7; 150_000];
    let server = github_server(archive(vec![
        ("manifest.json", serde_json::to_vec(&manifest).unwrap()),
        ("files/canvas.myelin", note.clone()),
        ("files/version.pdf", b"pdf".to_vec()),
        ("unrelated.txt", b"ignore".to_vec()),
    ]))
    .await;
    let prepared = download_repository(&stage, github_source(), &server.endpoints())
        .await
        .unwrap();
    assert_eq!(prepared, (2, 150_003));
    let paths = directory.cache();
    assert_eq!(
        fs::read(paths.cache.join("files/old.myelin")).unwrap(),
        b"offline content"
    );
    assert_eq!(fs::read(stage.join("files/canvas.myelin")).unwrap(), note);
    assert_eq!(fs::read(stage.join("files/version.pdf")).unwrap(), b"pdf");
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(
            &fs::read(stage.join("manifest.json")).unwrap()
        )
        .unwrap(),
        manifest
    );

    assert!(!stage.join("files/old.myelin").exists());
    assert!(!stage.join(".prepared.json").exists());
    assert!(!stage.join("unrelated.txt").exists());

    assert_eq!(server.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn github_rejects_an_archive_missing_repository_files() {
    let directory = TestDirectory::new();
    directory.seed_cache();
    let stage = directory.0.join("download");
    fs::create_dir_all(stage.join("files")).unwrap();
    let server = github_server(archive(vec![(
        "manifest.json",
        serde_json::to_vec(&manifest()).unwrap(),
    )]))
    .await;
    let error = download_repository(&stage, github_source(), &server.endpoints())
        .await
        .unwrap_err();
    assert!(error.contains("missing a repository file"));
    assert_eq!(
        fs::read(directory.cache().cache.join("files/old.myelin")).unwrap(),
        b"offline content"
    );
}

#[test]
fn rejects_traversal_and_symlinks() {
    let directory = TestDirectory::new();
    for root in [
        "../escape",
        "repositories/github/..",
        "repositories/github/test/extra",
        "/repositories/github/test",
        "repositories/github/test\\escape",
    ] {
        assert!(CachePaths::new(&directory.0, root).is_err());
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&directory.0, directory.cache().cache).unwrap();
        assert!(CachePaths::new(&directory.0, ROOT).is_err());
    }
}

#[tokio::test]
async fn drive_downloads_pinned_revisions_and_refuses_a_manifest_change() {
    for changed in [false, true] {
        let directory = TestDirectory::new();
        let stage = directory.0.join("download");
        fs::create_dir_all(stage.join("files")).unwrap();
        let body = serde_json::to_vec(&manifest()).unwrap();
        let lookups = AtomicU64::new(0);
        let server = TestServer::new(move |path| {
            if path.starts_with("/drive/files?") {
                let url = tauri_plugin_http::reqwest::Url::parse(&format!("http://test{path}")).unwrap();
                let query = url.query_pairs().find(|(key, _)| key == "q").unwrap().1.into_owned();
                let files = if query.contains("name = 'manifest.json'") {
                    let revision = if changed && lookups.fetch_add(1, Ordering::Relaxed) > 0 { "manifest-2" } else { "manifest-1" };
                    serde_json::json!([{ "id": "manifest", "name": "manifest.json", "headRevisionId": revision }])
                } else if query.contains("name = 'files'") {
                    serde_json::json!([{ "id": "files-folder", "name": "files" }])
                } else {
                    serde_json::json!([{ "id": "note", "name": "canvas.myelin", "headRevisionId": "note-1" }, { "id": "snapshot", "name": "version.pdf", "headRevisionId": "snapshot-1" }])
                };
                return (200, serde_json::to_vec(&serde_json::json!({"files": files})).unwrap());
            }
            match path {
                "/drive/files/manifest/revisions/manifest-1?alt=media" => (200, body.clone()),
                "/drive/files/note/revisions/note-1?alt=media" => (200, b"canvas".to_vec()),
                "/drive/files/snapshot/revisions/snapshot-1?alt=media" => (200, b"pdf".to_vec()),
                _ => (404, vec![]),
            }
        }).await;
        let result = download_repository(
            &stage,
            RepositorySource::GoogleDrive {
                folder_id: "folder".into(),
                token: "secret".into(),
            },
            &server.endpoints(),
        )
        .await;

        if changed {
            assert!(result.unwrap_err().contains("manifest changed"));
            assert!(!directory.cache().cache.exists());
        } else {
            result.unwrap();
            assert_eq!(
                fs::read(stage.join("files/canvas.myelin")).unwrap(),
                b"canvas"
            );
            assert_eq!(fs::read(stage.join("files/version.pdf")).unwrap(), b"pdf");
        }
    }
}

#[tokio::test]
async fn prepares_empty_github_repositories_without_creating_a_legacy_manifest() {
    for existing_empty in [false, true] {
        let directory = TestDirectory::new();
        let stage = directory.0.join("download");
        fs::create_dir_all(stage.join("files")).unwrap();
        let tarball = if existing_empty {
            archive(vec![("manifest.json", vec![])])
        } else {
            archive(vec![("README.md", b"notes".to_vec())])
        };
        let server = TestServer::new(move |path| match path {
            "/github/repos/owner/repo/branches/feature%2Fnotes" => (
                200,
                br#"{"commit":{"sha":"1111111111111111111111111111111111111111"}}"#.to_vec(),
            ),
            "/github/repos/owner/repo/tarball/1111111111111111111111111111111111111111" => {
                (200, tarball.clone())
            }
            _ => (404, vec![]),
        })
        .await;
        let prepared = download_repository(&stage, github_source(), &server.endpoints())
            .await
            .unwrap();
        assert_eq!((prepared.0, prepared.1), (0, 0));
        let loaded = crate::repository_metadata::load(&stage).unwrap();
        assert!(loaded.legacy.is_none());
        assert!(loaded.corrupt.is_empty());
        assert_eq!(loaded.manifest["nodes"], serde_json::json!({}));
        assert!(stage.join("repository.json").exists());
        assert!(server
            .messages
            .lock()
            .unwrap()
            .iter()
            .all(|message| message.starts_with("GET ")));
    }
}

#[tokio::test]
async fn prepares_empty_drive_repositories_without_creating_a_legacy_manifest() {
    for existing_empty in [false, true] {
        let directory = TestDirectory::new();
        let stage = directory.0.join("download");
        fs::create_dir_all(stage.join("files")).unwrap();
        let server = TestServer::new(move |path| {
            if path.starts_with("/drive/files?") {
                let files = if existing_empty && path.contains("manifest.json") {
                    serde_json::json!([{ "id": "manifest", "name": "manifest.json", "headRevisionId": "empty" }])
                } else { serde_json::json!([]) };
                return (200, serde_json::to_vec(&serde_json::json!({ "files": files })).unwrap());
            }
            match path {
                "/drive/files/manifest/revisions/empty?alt=media" => (200, vec![]),
                _ => (404, vec![]),
            }
        }).await;
        let prepared = download_repository(
            &stage,
            RepositorySource::GoogleDrive {
                folder_id: "folder".into(),
                token: "secret".into(),
            },
            &server.endpoints(),
        )
        .await
        .unwrap();
        assert_eq!(prepared.0, 0);

        let loaded = crate::repository_metadata::load(&stage).unwrap();
        assert!(loaded.legacy.is_none());
        assert!(loaded.corrupt.is_empty());
        assert_eq!(loaded.manifest["nodes"], serde_json::json!({}));
        assert!(stage.join("repository.json").exists());
        assert!(server
            .messages
            .lock()
            .unwrap()
            .iter()
            .all(|message| message.starts_with("GET ")));
    }
}

fn commit_files(repository: &git2::Repository, branch: &str, files: &[(&str, &[u8])]) -> git2::Oid {
    let mut index = git2::Index::new().unwrap();
    for (path, bytes) in files {
        let entry = git2::IndexEntry {
            ctime: git2::IndexTime::new(0, 0),
            mtime: git2::IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode: 0o100644,
            uid: 0,
            gid: 0,
            file_size: bytes.len() as u32,
            id: repository.blob(bytes).unwrap(),
            flags: 0,
            flags_extended: 0,
            path: path.as_bytes().to_vec(),
        };
        index.add(&entry).unwrap();
    }
    let tree = repository
        .find_tree(index.write_tree_to(repository).unwrap())
        .unwrap();
    let reference = format!("refs/heads/{branch}");
    let parent = repository
        .find_reference(&reference)
        .and_then(|head| head.peel_to_commit())
        .ok();
    let signature = git2::Signature::now("Test", "test@example.invalid").unwrap();
    repository
        .commit(
            Some(&reference),
            &signature,
            &signature,
            "update",
            &tree,
            &parent.iter().collect::<Vec<_>>(),
        )
        .unwrap()
}

#[tokio::test]
async fn github_git_pull_writes_the_snapshot_and_follows_new_commits() {
    let directory = TestDirectory::new();
    let remote_path = directory.0.join("remote.git");
    let remote = git2::Repository::init_bare(&remote_path).unwrap();
    let manifest = serde_json::to_vec(&manifest()).unwrap();
    let note = vec![7; 150_000];
    let first = commit_files(
        &remote,
        "feature/notes",
        &[
            ("manifest.json", &manifest),
            ("files/canvas.myelin", &note),
            ("files/version.pdf", b"pdf"),
            ("unrelated.txt", b"ignore"),
        ],
    );
    let url = remote_path.to_str().unwrap();
    let cache_dir = directory.0.join("app-cache");
    let pull = |stage: PathBuf| {
        let cache_dir = cache_dir.clone();
        async move {
            fs::create_dir_all(stage.join("files")).unwrap();
            download::download_github_git(
                &stage,
                &cache_dir,
                url,
                "owner",
                "repo",
                "feature/notes",
                "",
                &std::collections::HashMap::new(),
            )
            .await
        }
    };

    let stage = directory.0.join("first");
    assert_eq!(pull(stage.clone()).await.unwrap(), Some((2, 150_003)));
    assert_eq!(fs::read(stage.join("files/canvas.myelin")).unwrap(), note);
    assert_eq!(fs::read(stage.join("files/version.pdf")).unwrap(), b"pdf");
    assert_eq!(fs::read(stage.join("manifest.json")).unwrap(), manifest);
    assert_eq!(
        fs::read_to_string(stage.join(".remote-revision")).unwrap(),
        first.to_string()
    );
    assert!(!stage.join("unrelated.txt").exists());

    // The second pull fetches into the cached clone, whose branch lives under refs/remotes.
    let second = commit_files(
        &remote,
        "feature/notes",
        &[
            ("manifest.json", &manifest),
            ("files/canvas.myelin", b"edited on the tablet"),
            ("files/version.pdf", b"pdf"),
        ],
    );
    let stage = directory.0.join("second");
    assert_eq!(pull(stage.clone()).await.unwrap(), Some((2, 23)));
    assert_eq!(
        fs::read(stage.join("files/canvas.myelin")).unwrap(),
        b"edited on the tablet"
    );
    assert_eq!(
        fs::read_to_string(stage.join(".remote-revision")).unwrap(),
        second.to_string()
    );
}
