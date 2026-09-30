use super::download::{download_repository, RepositorySource};
use super::*;
use std::sync::Mutex;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const STAGE_ID: &str = "12345678-1234-1234-1234-123456789abc";
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
fn recovers_each_interrupted_publication_without_losing_outbox_or_sync_status() {
    for phase in 0..3 {
        let directory = TestDirectory::new();
        directory.seed_cache();
        let paths = directory.cache();
        let stage = paths.stage(STAGE_ID).unwrap();
        fs::create_dir_all(stage.join("files")).unwrap();
        fs::write(stage.join("manifest.json"), b"new manifest").unwrap();
        fs::write(stage.join("files/new.myelin"), b"new content").unwrap();
        fs::write(stage.join("outbox.json"), b"[]").unwrap();
        fs::write(stage.join("outbox.json.sync-status.json"), b"123").unwrap();
        fs::write(
            &paths.journal,
            serde_json::to_vec(&InstallJournal {
                stage_id: STAGE_ID.into(),
                had_cache: true,
            })
            .unwrap(),
        )
        .unwrap();
        if phase >= 1 {
            fs::rename(&paths.cache, &paths.backup).unwrap();
        }
        if phase == 2 {
            fs::rename(&stage, &paths.cache).unwrap();
        }
        recover_cache(&paths).unwrap();
        let file = if phase == 2 {
            "files/new.myelin"
        } else {
            "files/old.myelin"
        };
        assert!(paths.cache.join(file).exists());
        assert_eq!(fs::read(paths.cache.join("outbox.json")).unwrap(), b"[]");
        assert_eq!(
            fs::read(paths.cache.join("outbox.json.sync-status.json")).unwrap(),
            b"123"
        );
        assert!(!stage.exists() && !paths.backup.exists() && !paths.journal.exists());
        recover_cache(&paths).unwrap();
    }
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
    assert!(directory.cache().stage("../escape").is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&directory.0, directory.0.join("repositories/github/test"))
            .unwrap();
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
async fn initializes_missing_and_zero_length_github_manifests_without_sending_files_through_js() {
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
            "/github/repos/owner/repo/contents/manifest.json" => (201, b"{}".to_vec()),
            _ => (404, vec![]),
        })
        .await;
        let prepared = download_repository(&stage, github_source(), &server.endpoints())
            .await
            .unwrap();
        assert_eq!((prepared.0, prepared.1), (0, 0));
        let messages = server.messages.lock().unwrap();
        let write = messages
            .iter()
            .find(|message| message.starts_with("PUT "))
            .unwrap();
        let body: serde_json::Value =
            serde_json::from_str(write.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["branch"], "feature/notes");
        assert_eq!(body["sha"].is_string(), existing_empty);
        if existing_empty {
            assert_eq!(body["sha"], "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
        }
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(body["content"].as_str().unwrap())
            .unwrap();
        let manifest: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(manifest["version"], 3);
        assert_eq!(manifest["nodes"], serde_json::json!({}));
        assert_eq!(fs::read(stage.join("manifest.json")).unwrap(), bytes);
    }
}

#[tokio::test]
async fn initializes_new_and_zero_length_drive_manifests_with_the_existing_format() {
    for existing_empty in [false, true] {
        let directory = TestDirectory::new();
        let stage = directory.0.join("download");
        fs::create_dir_all(stage.join("files")).unwrap();
        let server = TestServer::new(move |path| {
            if path.starts_with("/drive/files?") {
                let files = if existing_empty {
                    serde_json::json!([{ "id": "manifest", "name": "manifest.json", "headRevisionId": "empty" }])
                } else { serde_json::json!([]) };
                return (200, serde_json::to_vec(&serde_json::json!({ "files": files })).unwrap());
            }
            match path {
                "/drive/files/manifest/revisions/empty?alt=media" => (200, vec![]),
                "/drive/files" => (200, br#"{"id":"manifest"}"#.to_vec()),
                "/upload/files/manifest?uploadType=media" => (200, br#"{"id":"manifest","headRevisionId":"new"}"#.to_vec()),
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

        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(stage.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["version"], 3);
        assert_eq!(manifest["nodes"], serde_json::json!({}));
        assert_eq!(
            manifest["colors"],
            serde_json::json!({"pen": [], "highlighter": [], "text": [], "folder": []})
        );
        let messages = server.messages.lock().unwrap();
        let upload = messages
            .iter()
            .find(|message| message.starts_with("PATCH "))
            .unwrap();
        let body: serde_json::Value =
            serde_json::from_str(upload.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body, manifest);
        let created = messages.iter().find(|message| message.starts_with("POST "));
        assert_eq!(created.is_none(), existing_empty);
        if let Some(created) = created {
            let body: serde_json::Value =
                serde_json::from_str(created.split_once("\r\n\r\n").unwrap().1).unwrap();
            assert_eq!(body["parents"], serde_json::json!(["folder"]));
            assert_eq!(body["name"], "manifest.json");
        }
    }
}
