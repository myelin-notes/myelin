use std::{
    collections::HashMap,
    fs::File,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri_plugin_http::reqwest::{self, Client, Method, Response, Url};
use tokio::io::AsyncWriteExt;

use super::{io_error, valid_component, write_durable};
use crate::repository_metadata as metadata;

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RepositorySource {
    Github {
        owner: String,
        repo: String,
        branch: String,
        token: String,
    },
    #[serde(rename = "google-drive")]
    GoogleDrive {
        #[serde(rename = "folderId")]
        folder_id: String,
        token: String,
    },
}

#[derive(Clone)]
pub(crate) struct RemoteEndpoints {
    pub github: String,
    pub drive: String,
    pub drive_upload: String,
}

impl Default for RemoteEndpoints {
    fn default() -> Self {
        Self {
            github: "https://api.github.com".into(),
            drive: "https://www.googleapis.com/drive/v3".into(),
            drive_upload: "https://www.googleapis.com/upload/drive/v3".into(),
        }
    }
}

pub(crate) struct RemoteClient {
    pub(crate) client: Client,
    pub(crate) token: String,
    pub(crate) github: bool,
}

pub(crate) struct CachedFile {
    pub(crate) path: PathBuf,
    pub(crate) revision: String,
    pub(crate) drive_id: Option<String>,
}

impl CachedFile {
    pub(crate) fn link(&self, destination: &Path, revision: &str, drive_id: Option<&str>) -> bool {
        !revision.is_empty()
            && self.revision == revision
            && self.drive_id.as_deref() == drive_id
            && std::fs::hard_link(&self.path, destination).is_ok()
    }
}

impl RemoteClient {
    pub(crate) fn new(token: String, github: bool) -> Result<Self, String> {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|_| "Repository download client unavailable")?;
        Ok(Self {
            client,
            token,
            github,
        })
    }

    pub(crate) async fn request(
        &self,
        label: &str,
        method: Method,
        url: Url,
        body: Option<Value>,
    ) -> Result<Response, String> {
        let mut slept = Duration::ZERO;
        let attempts = if self.github { 2 } else { 4 };
        for attempt in 0..attempts {
            let mut request = self
                .client
                .request(method.clone(), url.clone())
                .bearer_auth(&self.token);
            if self.github {
                request = request
                    .header("Accept", "application/vnd.github+json")
                    .header("User-Agent", "myelin")
                    .header("X-GitHub-Api-Version", "2022-11-28");
            }
            if let Some(body) = &body {
                request = request
                    .header("Content-Type", "application/json")
                    .body(serde_json::to_vec(body).map_err(|_| "Invalid repository request")?);
            }
            let response = request
                .send()
                .await
                .map_err(|_| format!("{label} before receiving a response"))?;
            let status = response.status().as_u16();
            let retryable = matches!(status, 403 | 429) || (!self.github && status >= 500);
            let delay = retry_delay(&response, attempt, self.github);
            if retryable && attempt + 1 < attempts {
                if let Some(delay) = delay.filter(|delay| slept + *delay <= Duration::from_secs(60))
                {
                    slept += delay;
                    tokio::time::sleep(delay).await;
                    continue;
                }
            }
            if response.status().is_success() || response.status().is_redirection() || status == 404
            {
                return Ok(response);
            }
            return Err(format!("{label} ({status})"));
        }
        Err(format!("{label}: exhausted retries"))
    }

    pub(crate) async fn json(
        &self,
        label: &str,
        method: Method,
        url: Url,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let response = require_success(self.request(label, method, url, body).await?, label)?;
        let bytes = response
            .bytes()
            .await
            .map_err(|_| format!("{label}: unreadable response"))?;
        serde_json::from_slice(&bytes).map_err(|_| format!("{label}: unreadable response"))
    }
}

fn retry_delay(response: &Response, attempt: usize, github: bool) -> Option<Duration> {
    if let Some(seconds) = response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
    {
        return Some(Duration::from_secs(seconds.min(60)));
    }
    if github {
        let reset = response
            .headers()
            .get("x-ratelimit-reset")?
            .to_str()
            .ok()?
            .parse::<u64>()
            .ok()?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
        return Some(Duration::from_secs(reset.saturating_sub(now).min(60)));
    }
    Some(Duration::from_millis(
        (500 * 2_u64.pow(attempt as u32)).min(60_000),
    ))
}

pub(crate) fn require_success(response: Response, label: &str) -> Result<Response, String> {
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(format!("{label} ({})", response.status().as_u16()))
    }
}

pub(crate) fn endpoint(base: &str, segments: &[&str]) -> Result<Url, String> {
    let mut url = Url::parse(base).map_err(|_| "Invalid repository endpoint")?;
    url.path_segments_mut()
        .map_err(|_| "Invalid repository endpoint")?
        .extend(segments);
    Ok(url)
}

pub(crate) fn manifest_files(manifest: &Value) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    for (key, node) in manifest["nodes"]
        .as_object()
        .ok_or("Invalid repository manifest")?
    {
        if node["type"] == "folder" {
            continue;
        }
        if node["type"] != "file" {
            return Err("Invalid repository manifest node".into());
        }
        let id = node["id"]
            .as_str()
            .filter(|id| valid_component(id) && *id == key)
            .ok_or("Invalid repository file ID")?;
        let file_type = node["fileType"]
            .as_str()
            .filter(|value| valid_component(value))
            .ok_or("Invalid repository file type")?;
        files.push(format!(
            "{id}.{}",
            if file_type == "mcanvas" {
                "myelin"
            } else {
                file_type
            }
        ));
    }
    Ok(files)
}

pub(crate) async fn download_repository(
    stage: &Path,
    source: RepositorySource,
    endpoints: &RemoteEndpoints,
) -> Result<(usize, u64), String> {
    download_repository_cached(stage, source, endpoints, &HashMap::new()).await
}

pub(crate) async fn download_repository_cached(
    stage: &Path,
    source: RepositorySource,
    endpoints: &RemoteEndpoints,
    cached: &HashMap<String, CachedFile>,
) -> Result<(usize, u64), String> {
    match source {
        RepositorySource::Github {
            owner,
            repo,
            branch,
            token,
        } => {
            if !valid_component(&owner)
                || !valid_component(&repo)
                || !git2::Reference::is_valid_name(&format!("refs/heads/{branch}"))
            {
                return Err("Invalid GitHub repository configuration".into());
            }
            let client = RemoteClient::new(token, true)?;
            if !cached.is_empty() {
                if let Some(result) = download_github_cached(
                    stage, &client, endpoints, &owner, &repo, &branch, cached,
                )
                .await?
                {
                    return Ok(result);
                }
            }
            download_github(stage, &client, endpoints, &owner, &repo, &branch).await
        }
        RepositorySource::GoogleDrive { folder_id, token } => {
            if folder_id.is_empty() {
                return Err("Google Drive folder is not configured".into());
            }
            let client = RemoteClient::new(token, false)?;
            download_drive(stage, &client, endpoints, &folder_id, cached).await
        }
    }
}

async fn save_response(
    mut response: Response,
    destination: &Path,
    label: &str,
) -> Result<u64, String> {
    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(io_error)?;
    let mut size = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| format!("{label} while receiving content"))?
    {
        file.write_all(&chunk).await.map_err(io_error)?;
        size += chunk.len() as u64;
    }
    file.sync_all().await.map_err(io_error)?;
    Ok(size)
}

async fn download_github(
    stage: &Path,
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    owner: &str,
    repo: &str,
    branch: &str,
) -> Result<(usize, u64), String> {
    let head = client
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
    let revision = head["commit"]["sha"]
        .as_str()
        .filter(|value| git2::Oid::from_str(value).is_ok())
        .ok_or("Invalid GitHub branch revision")?;
    let url = endpoint(
        &endpoints.github,
        &["repos", owner, repo, "tarball", revision],
    )?;
    let mut response = client
        .request("GitHub tarball request failed", Method::GET, url, None)
        .await?;
    if response.status().is_redirection() {
        let location = response
            .headers()
            .get("location")
            .and_then(|value| value.to_str().ok())
            .ok_or("GitHub tarball redirect missing Location")?;
        let url = Url::parse(location).map_err(|_| "Invalid GitHub tarball redirect")?;
        if url.scheme() != "https" || url.host_str() != Some("codeload.github.com") {
            return Err("Invalid GitHub tarball redirect".into());
        }
        response = client
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| "GitHub tarball download failed")?;
    }
    let archive = stage.join(".archive.tar.gz");
    save_response(
        require_success(response, "GitHub tarball request failed")?,
        &archive,
        "GitHub tarball download failed",
    )
    .await?;
    let stage_path = stage.to_owned();
    let extracted = tauri::async_runtime::spawn_blocking(move || extract_archive(&stage_path))
        .await
        .map_err(|_| "GitHub archive extraction task failed")??;
    std::fs::remove_file(archive).map_err(io_error)?;
    tokio::fs::write(stage.join(".remote-revision"), revision)
        .await
        .map_err(io_error)?;
    Ok(extracted)
}

async fn download_github_cached(
    stage: &Path,
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    owner: &str,
    repo: &str,
    branch: &str,
    cached: &HashMap<String, CachedFile>,
) -> Result<Option<(usize, u64)>, String> {
    let url = |parts: &[&str]| {
        let mut segments = vec!["repos", owner, repo];
        segments.extend(parts);
        endpoint(&endpoints.github, &segments)
    };
    let head = client
        .json(
            "GitHub branch request failed",
            Method::GET,
            url(&["branches", branch])?,
            None,
        )
        .await?;
    let revision = head["commit"]["sha"]
        .as_str()
        .filter(|sha| git2::Oid::from_str(sha).is_ok())
        .ok_or("Invalid GitHub branch revision")?;
    let commit = client
        .json(
            "GitHub commit request failed",
            Method::GET,
            url(&["git", "commits", revision])?,
            None,
        )
        .await?;
    let tree_sha = commit["tree"]["sha"]
        .as_str()
        .filter(|sha| git2::Oid::from_str(sha).is_ok())
        .ok_or("Invalid GitHub tree revision")?;
    let mut tree_url = url(&["git", "trees", tree_sha])?;
    tree_url.query_pairs_mut().append_pair("recursive", "1");
    let tree = client
        .json("GitHub tree request failed", Method::GET, tree_url, None)
        .await?;
    if tree["truncated"] == true {
        return Ok(None);
    }
    let entries: HashMap<_, _> = tree["tree"]
        .as_array()
        .ok_or("Unreadable GitHub repository tree")?
        .iter()
        .filter_map(|entry| entry["path"].as_str().map(|path| (path, entry)))
        .collect();
    let blob_revision = |path: &str| -> Result<&str, String> {
        let entry = entries
            .get(path)
            .ok_or("GitHub tree is missing a repository file")?;
        if entry["type"] != "blob" || !matches!(entry["mode"].as_str(), Some("100644" | "100755")) {
            return Err("GitHub tree contains an invalid repository file".into());
        }
        entry["sha"]
            .as_str()
            .filter(|sha| git2::Oid::from_str(sha).is_ok())
            .ok_or("Invalid GitHub blob revision".into())
    };
    if !entries.contains_key("manifest.json") {
        return Ok(None);
    }
    let manifest_sha = blob_revision("manifest.json")?;
    let manifest_bytes = if cached
        .get("manifest.json")
        .is_some_and(|file| file.link(&stage.join("manifest.json"), manifest_sha, None))
    {
        std::fs::read(stage.join("manifest.json")).map_err(io_error)?
    } else {
        github_blob(client, url(&["git", "blobs", manifest_sha])?, manifest_sha).await?
    };
    if manifest_bytes.is_empty() {
        return Ok(None);
    }
    let manifest = if metadata::is_marker(&manifest_bytes)
        || (metadata::legacy::parse_manifest(&manifest_bytes).is_err()
            && entries
                .keys()
                .any(|path| *path == metadata::SETTINGS || metadata::is_metadata_path(path)))
    {
        if !stage.join("manifest.json").exists() {
            write_durable(&stage.join("manifest.json"), &manifest_bytes)?;
        }
        for path in entries
            .keys()
            .filter(|path| **path == metadata::SETTINGS || metadata::is_metadata_path(path))
        {
            let sha = blob_revision(path)?;
            let destination = stage.join(path);
            if !cached
                .get(*path)
                .is_some_and(|file| file.link(&destination, sha, None))
            {
                let bytes = github_blob(client, url(&["git", "blobs", sha])?, sha).await?;
                write_durable(&destination, &bytes)?;
            }
        }
        metadata::load(stage)?.manifest
    } else {
        metadata::legacy::parse_manifest(&manifest_bytes)?
    };
    let files = manifest_files(&manifest)?;
    let mut size = 0;
    for name in &files {
        let sha = blob_revision(&format!("files/{name}"))?;
        let destination = stage.join("files").join(name);
        if cached
            .get(name)
            .is_some_and(|file| file.link(&destination, sha, None))
        {
            continue;
        }
        let bytes = github_blob(client, url(&["git", "blobs", sha])?, sha).await?;
        size += bytes.len() as u64;
        write_durable(&destination, &bytes)?;
    }
    if !stage.join("manifest.json").exists() {
        write_durable(&stage.join("manifest.json"), &manifest_bytes)?;
    }
    write_durable(&stage.join(".remote-revision"), revision.as_bytes())?;
    super::sync_directory(&stage.join("files"))?;
    super::sync_directory(stage)?;
    Ok(Some((files.len(), size)))
}

async fn github_blob(client: &RemoteClient, url: Url, revision: &str) -> Result<Vec<u8>, String> {
    let blob = client
        .json("GitHub blob download failed", Method::GET, url, None)
        .await?;
    if blob["encoding"] != "base64" {
        return Err("Unreadable GitHub blob encoding".into());
    }
    let content: Vec<_> = blob["content"]
        .as_str()
        .ok_or("Unreadable GitHub blob content")?
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect();
    let bytes = STANDARD
        .decode(content)
        .map_err(|_| "Unreadable GitHub blob content")?;
    let sha = git2::Oid::hash_object(git2::ObjectType::Blob, &bytes)
        .map_err(|_| "GitHub blob revision unavailable")?;
    if sha.to_string() != revision {
        return Err("GitHub blob does not match its pinned revision".into());
    }
    Ok(bytes)
}

fn archive_name(path: &Path) -> Option<String> {
    let text = path.to_str()?;
    let (_, name) = text.split_once('/')?;
    Some(name.to_owned())
}

fn extract_archive(stage: &Path) -> Result<(usize, u64), String> {
    if stage.join("manifest.json").exists() {
        std::fs::remove_file(stage.join("manifest.json")).map_err(io_error)?;
    }
    let archive = || -> Result<tar::Archive<flate2::read::GzDecoder<File>>, String> {
        Ok(tar::Archive::new(flate2::read::GzDecoder::new(
            File::open(stage.join(".archive.tar.gz")).map_err(io_error)?,
        )))
    };
    let mut manifest_bytes = None;
    let mut records = HashMap::new();
    for entry in archive()?.entries().map_err(io_error)? {
        let mut entry = entry.map_err(io_error)?;
        let Some(name) = archive_name(&entry.path().map_err(io_error)?) else {
            continue;
        };
        if name == "manifest.json"
            || name == metadata::SETTINGS
            || metadata::is_metadata_path(&name)
        {
            if !entry.header().entry_type().is_file() {
                return Err("GitHub archive contains invalid repository metadata".into());
            }
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut entry, &mut bytes).map_err(io_error)?;
            if name == "manifest.json" {
                manifest_bytes = Some(bytes);
            } else if records.insert(name, bytes).is_some() {
                return Err("Duplicate repository metadata in GitHub archive".into());
            }
        }
    }
    let bytes = match manifest_bytes {
        Some(bytes) => {
            write_durable(&stage.join("manifest.json"), &bytes)?;
            bytes
        }
        None => Vec::new(),
    };
    if bytes.is_empty() && records.is_empty() {
        write_durable(
            &stage.join(metadata::SETTINGS),
            &metadata::settings(&metadata::empty_manifest())?,
        )?;
        return Ok((0, 0));
    }
    let manifest = if metadata::is_marker(&bytes)
        || (metadata::legacy::parse_manifest(&bytes).is_err() && !records.is_empty())
    {
        for (path, bytes) in records {
            write_durable(&stage.join(path), &bytes)?;
        }
        metadata::load(stage)?.manifest
    } else {
        metadata::legacy::parse_manifest(&bytes)?
    };
    let files = manifest_files(&manifest)?;
    let mut remaining: HashMap<_, _> = files
        .iter()
        .map(|name| (format!("files/{name}"), name))
        .collect();
    let mut size = 0;
    for entry in archive()?.entries().map_err(io_error)? {
        let mut entry = entry.map_err(io_error)?;
        let Some(name) = archive_name(&entry.path().map_err(io_error)?) else {
            continue;
        };
        let Some(file_name) = remaining.remove(&name) else {
            continue;
        };
        if !entry.header().entry_type().is_file() {
            return Err("GitHub archive contains an invalid repository file".into());
        }
        let mut file = File::create(stage.join("files").join(file_name)).map_err(io_error)?;
        size += std::io::copy(&mut entry, &mut file).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
    }
    if !remaining.is_empty() {
        return Err("GitHub archive is missing a repository file".into());
    }
    Ok((files.len(), size))
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriveEntry {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) name: String,
    pub(crate) head_revision_id: Option<String>,
    #[serde(default)]
    pub(crate) app_properties: HashMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveList {
    #[serde(default)]
    files: Vec<DriveEntry>,
    next_page_token: Option<String>,
}

fn escape_query(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

pub(crate) async fn list_drive(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    query: &str,
    page_size: &str,
) -> Result<Vec<DriveEntry>, String> {
    let mut entries = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut url = endpoint(&endpoints.drive, &["files"])?;
        url.query_pairs_mut()
            .append_pair("q", query)
            .append_pair(
                "fields",
                "nextPageToken,files(id,name,headRevisionId,appProperties)",
            )
            .append_pair("pageSize", page_size);
        if let Some(token) = &page_token {
            url.query_pairs_mut().append_pair("pageToken", token);
        }
        let payload = client
            .json("Google Drive list failed", Method::GET, url, None)
            .await?;
        let list: DriveList =
            serde_json::from_value(payload).map_err(|_| "Unreadable Google Drive list")?;
        entries.extend(list.files);
        page_token = list.next_page_token;
        if page_token.is_none() {
            return Ok(entries);
        }
    }
}

pub(crate) async fn find_drive(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    parent: &str,
    name: &str,
    folder: bool,
) -> Result<Option<DriveEntry>, String> {
    let mut query = format!(
        "'{}' in parents and name = '{}' and trashed = false",
        escape_query(parent),
        escape_query(name)
    );
    if folder {
        query.push_str(" and mimeType = 'application/vnd.google-apps.folder'");
    }
    let mut entries = list_drive(client, endpoints, &query, "1000").await?;
    if entries.len() > 1 {
        return Err(format!(
            "Duplicate Google Drive repository entry: {name}; recovery required"
        ));
    }
    Ok(entries.pop())
}

async fn download_drive_entry(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    entry: &DriveEntry,
    destination: &Path,
) -> Result<u64, String> {
    let mut url = if let Some(revision) = &entry.head_revision_id {
        endpoint(
            &endpoints.drive,
            &["files", &entry.id, "revisions", revision],
        )?
    } else {
        endpoint(&endpoints.drive, &["files", &entry.id])?
    };
    url.query_pairs_mut().append_pair("alt", "media");
    let response = require_success(
        client
            .request("Google Drive download failed", Method::GET, url, None)
            .await?,
        "Google Drive download failed",
    )?;
    save_response(response, destination, "Google Drive download failed").await
}

async fn download_drive(
    stage: &Path,
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    folder: &str,
    cached: &HashMap<String, CachedFile>,
) -> Result<(usize, u64), String> {
    let manifest_entry = find_drive(client, endpoints, folder, "manifest.json", false).await?;
    if let Some(entry) = &manifest_entry {
        download_drive_entry(client, endpoints, entry, &stage.join("manifest.json")).await?;
    }
    let bytes = if manifest_entry.is_some() {
        tokio::fs::read(stage.join("manifest.json"))
            .await
            .map_err(io_error)?
    } else {
        Vec::new()
    };
    let files_folder = find_drive(client, endpoints, folder, "files", true).await?;
    let query = files_folder.as_ref().map(|entry| {
        format!(
            "'{}' in parents and trashed = false",
            escape_query(&entry.id)
        )
    });
    let entries: HashMap<_, _> = if let Some(query) = &query {
        let mut entries = HashMap::new();
        for entry in list_drive(client, endpoints, query, "1000").await? {
            if entries.insert(entry.name.clone(), entry).is_some() {
                return Err("Duplicate Google Drive repository filename; recovery required".into());
            }
        }
        entries
    } else {
        HashMap::new()
    };
    let settings_entry = if metadata::legacy::parse_manifest(&bytes).is_err() {
        find_drive(client, endpoints, folder, metadata::SETTINGS, false).await?
    } else {
        None
    };
    let sidecars = metadata::is_marker(&bytes)
        || (metadata::legacy::parse_manifest(&bytes).is_err()
            && (settings_entry.is_some()
                || entries.keys().any(|name| name.ends_with(metadata::SUFFIX))));
    let fresh = bytes.is_empty() && !sidecars;
    if fresh {
        write_durable(
            &stage.join(metadata::SETTINGS),
            &metadata::settings(&metadata::empty_manifest())?,
        )?;
    }
    let sidecars = sidecars || fresh;
    let manifest = if sidecars {
        if let Some(entry) = &settings_entry {
            if !entry.head_revision_id.as_deref().is_some_and(|revision| {
                cached.get(metadata::SETTINGS).is_some_and(|file| {
                    file.link(&stage.join(metadata::SETTINGS), revision, Some(&entry.id))
                })
            }) {
                download_drive_entry(client, endpoints, entry, &stage.join(metadata::SETTINGS))
                    .await?;
            }
        }
        for (name, entry) in entries
            .iter()
            .filter(|(name, _)| name.ends_with(metadata::SUFFIX))
        {
            let path = format!("files/{name}");
            if !metadata::is_metadata_path(&path) {
                return Err("Invalid Google Drive metadata path".into());
            }
            if !entry.head_revision_id.as_deref().is_some_and(|revision| {
                cached
                    .get(&path)
                    .is_some_and(|file| file.link(&stage.join(&path), revision, Some(&entry.id)))
            }) {
                download_drive_entry(client, endpoints, entry, &stage.join(&path)).await?;
            }
        }
        metadata::load(stage)?.manifest
    } else {
        metadata::legacy::parse_manifest(&bytes)?
    };
    let files = manifest_files(&manifest)?;
    let mut size = 0;
    for batch in files.chunks(8) {
        let mut tasks = tokio::task::JoinSet::new();
        for name in batch {
            let entry = entries
                .get(name)
                .ok_or("Google Drive is missing a repository file")?
                .clone();
            let destination = stage.join("files").join(name);
            if entry.head_revision_id.as_deref().is_some_and(|revision| {
                cached
                    .get(name)
                    .is_some_and(|file| file.link(&destination, revision, Some(&entry.id)))
            }) {
                continue;
            }
            let client = RemoteClient {
                client: client.client.clone(),
                token: client.token.clone(),
                github: false,
            };
            let endpoints = RemoteEndpoints {
                github: endpoints.github.clone(),
                drive: endpoints.drive.clone(),
                drive_upload: endpoints.drive_upload.clone(),
            };
            tasks.spawn(async move {
                download_drive_entry(&client, &endpoints, &entry, &destination).await
            });
        }
        while let Some(result) = tasks.join_next().await {
            match result
                .map_err(|_| "Google Drive download task failed".to_string())
                .and_then(|result| result)
            {
                Ok(bytes) => size += bytes,
                Err(error) => {
                    tasks.shutdown().await;
                    return Err(error);
                }
            }
        }
    }
    if find_drive(client, endpoints, folder, "manifest.json", false).await? != manifest_entry {
        return Err("Google Drive manifest changed during download".into());
    }
    if sidecars
        && find_drive(client, endpoints, folder, metadata::SETTINGS, false).await? != settings_entry
    {
        return Err("Google Drive metadata changed during download".into());
    }
    if let Some(query) = query {
        let current: HashMap<_, _> = list_drive(client, endpoints, &query, "1000")
            .await?
            .into_iter()
            .map(|entry| (entry.name.clone(), entry))
            .collect();
        if files
            .iter()
            .any(|name| entries.get(name) != current.get(name))
            || entries
                .iter()
                .filter(|(name, _)| name.ends_with(metadata::SUFFIX))
                .any(|(name, entry)| current.get(name) != Some(entry))
            || current
                .keys()
                .any(|name| name.ends_with(metadata::SUFFIX) && !entries.contains_key(name))
        {
            return Err("Google Drive repository file changed during download".into());
        }
    }
    let mut revisions = entries;
    if let Some(entry) = settings_entry {
        revisions.insert(metadata::SETTINGS.into(), entry);
    }
    if let Some(entry) = manifest_entry {
        revisions.insert("manifest.json".into(), entry);
    }
    tokio::fs::write(
        stage.join(".remote-drive.json"),
        serde_json::to_vec(&revisions).map_err(|error| error.to_string())?,
    )
    .await
    .map_err(io_error)?;
    super::sync_directory(&stage.join("files"))?;
    super::sync_directory(stage)?;
    Ok((files.len(), size))
}
