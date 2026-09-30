use std::{
    collections::HashMap,
    fs::File,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri_plugin_http::reqwest::{self, Client, Method, Response, Url};
use tokio::io::AsyncWriteExt;

use super::{io_error, valid_component, write_durable};

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

pub(crate) fn empty_manifest() -> Value {
    json!({ "version": 3, "nodes": {}, "linksBySource": {}, "colors": { "pen": [], "highlighter": [], "text": [], "folder": [] }, "tagRegistry": [], "penPresets": [] })
}

pub(crate) fn parse_manifest(bytes: &[u8]) -> Result<Value, String> {
    let manifest: Value =
        serde_json::from_slice(bytes).map_err(|_| "Unreadable repository manifest")?;
    if !manifest.get("version").is_some_and(Value::is_number)
        || !manifest.get("nodes").is_some_and(Value::is_object)
    {
        return Err("Invalid repository manifest".into());
    }
    Ok(manifest)
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
            download_github(stage, &client, endpoints, &owner, &repo, &branch).await
        }
        RepositorySource::GoogleDrive { folder_id, token } => {
            if folder_id.is_empty() {
                return Err("Google Drive folder is not configured".into());
            }
            let client = RemoteClient::new(token, false)?;
            download_drive(stage, &client, endpoints, &folder_id).await
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

async fn save_manifest(stage: &Path, manifest: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(manifest).map_err(|error| error.to_string())?;
    let mut file = tokio::fs::File::create(stage.join("manifest.json"))
        .await
        .map_err(io_error)?;
    file.write_all(&bytes).await.map_err(io_error)?;
    file.sync_all().await.map_err(io_error)
}

async fn download_github(
    stage: &Path,
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    owner: &str,
    repo: &str,
    branch: &str,
) -> Result<(usize, u64), String> {
    for _ in 0..4 {
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
        if let Some(result) = extracted {
            tokio::fs::write(stage.join(".remote-revision"), revision)
                .await
                .map_err(io_error)?;
            return Ok(result);
        }
        let existing_empty = stage.join("manifest.json").exists();
        let manifest = empty_manifest();
        let bytes = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
        let mut body = json!({ "message": "Initialize empty repository manifest", "content": STANDARD.encode(&bytes), "branch": branch });
        if existing_empty {
            body["sha"] = json!(git2::Oid::hash_object(git2::ObjectType::Blob, &[])
                .map_err(|_| "GitHub manifest revision unavailable")?
                .to_string());
        }
        let response = client
            .request(
                "GitHub manifest initialization failed",
                Method::PUT,
                endpoint(
                    &endpoints.github,
                    &["repos", owner, repo, "contents", "manifest.json"],
                )?,
                Some(body),
            )
            .await;
        match response {
            Ok(response) if response.status().is_success() => {
                let response = response
                    .bytes()
                    .await
                    .map_err(|_| "GitHub manifest initialization response failed")?;
                let payload: Value = serde_json::from_slice(&response).unwrap_or(Value::Null);
                tokio::fs::write(
                    stage.join(".remote-revision"),
                    payload["commit"]["sha"].as_str().unwrap_or(revision),
                )
                .await
                .map_err(io_error)?;
                save_manifest(stage, &manifest).await?;
                return Ok((0, 0));
            }
            Err(error) if error.contains("(409)") || error.contains("(422)") => continue,
            Ok(response) => {
                return Err(format!(
                    "GitHub manifest initialization failed ({})",
                    response.status().as_u16()
                ))
            }
            Err(error) => return Err(error),
        }
    }
    Err("GitHub manifest changed during initialization".into())
}

fn archive_name(path: &Path) -> Option<String> {
    let text = path.to_str()?;
    let (_, name) = text.split_once('/')?;
    Some(name.to_owned())
}

fn extract_archive(stage: &Path) -> Result<Option<(usize, u64)>, String> {
    if stage.join("manifest.json").exists() {
        std::fs::remove_file(stage.join("manifest.json")).map_err(io_error)?;
    }
    let archive = || -> Result<tar::Archive<flate2::read::GzDecoder<File>>, String> {
        Ok(tar::Archive::new(flate2::read::GzDecoder::new(
            File::open(stage.join(".archive.tar.gz")).map_err(io_error)?,
        )))
    };
    let mut manifest_bytes = None;
    for entry in archive()?.entries().map_err(io_error)? {
        let mut entry = entry.map_err(io_error)?;
        if entry.header().entry_type().is_file()
            && archive_name(&entry.path().map_err(io_error)?) == Some("manifest.json".into())
        {
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut entry, &mut bytes).map_err(io_error)?;
            manifest_bytes = Some(bytes);
            break;
        }
    }
    let Some(bytes) = manifest_bytes else {
        return Ok(None);
    };
    write_durable(&stage.join("manifest.json"), &bytes)?;
    if bytes.is_empty() {
        return Ok(None);
    }
    let manifest = parse_manifest(&bytes)?;
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
    Ok(Some((files.len(), size)))
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriveEntry {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) name: String,
    pub(crate) head_revision_id: Option<String>,
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
            .append_pair("fields", "nextPageToken,files(id,name,headRevisionId)")
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
    Ok(list_drive(client, endpoints, &query, "1")
        .await?
        .into_iter()
        .next())
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

async fn initialize_drive_manifest(
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    folder: &str,
    existing: Option<&DriveEntry>,
) -> Result<Value, String> {
    let target = match existing {
        Some(entry) => entry.id.clone(),
        None => client
            .json(
                "Google Drive create failed",
                Method::POST,
                endpoint(&endpoints.drive, &["files"])?,
                Some(json!({ "name": "manifest.json", "parents": [folder] })),
            )
            .await?["id"]
            .as_str()
            .ok_or("Google Drive create returned no file ID")?
            .to_owned(),
    };
    let manifest = empty_manifest();
    let mut url = endpoint(&endpoints.drive_upload, &["files", &target])?;
    url.query_pairs_mut().append_pair("uploadType", "media");
    client
        .json(
            "Google Drive manifest initialization failed",
            Method::PATCH,
            url,
            Some(manifest.clone()),
        )
        .await?;
    Ok(manifest)
}

async fn download_drive(
    stage: &Path,
    client: &RemoteClient,
    endpoints: &RemoteEndpoints,
    folder: &str,
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
    if bytes.is_empty() {
        if find_drive(client, endpoints, folder, "manifest.json", false).await? != manifest_entry {
            return Err("Google Drive manifest changed during initialization".into());
        }
        let manifest =
            initialize_drive_manifest(client, endpoints, folder, manifest_entry.as_ref()).await?;
        save_manifest(stage, &manifest).await?;
        return Ok((0, 0));
    }
    let manifest = parse_manifest(&bytes)?;
    let files = manifest_files(&manifest)?;
    let files_folder = find_drive(client, endpoints, folder, "files", true).await?;
    let query = files_folder.as_ref().map(|entry| {
        format!(
            "'{}' in parents and trashed = false",
            escape_query(&entry.id)
        )
    });
    let entries: HashMap<_, _> = if let Some(query) = &query {
        list_drive(client, endpoints, query, "1000")
            .await?
            .into_iter()
            .map(|entry| (entry.name.clone(), entry))
            .collect()
    } else {
        HashMap::new()
    };
    let mut size = 0;
    for batch in files.chunks(8) {
        let mut tasks = tokio::task::JoinSet::new();
        for name in batch {
            let entry = entries
                .get(name)
                .ok_or("Google Drive is missing a repository file")?
                .clone();
            let destination = stage.join("files").join(name);
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
    if let Some(query) = query {
        let current: HashMap<_, _> = list_drive(client, endpoints, &query, "1000")
            .await?
            .into_iter()
            .map(|entry| (entry.name.clone(), entry))
            .collect();
        if files
            .iter()
            .any(|name| entries.get(name) != current.get(name))
        {
            return Err("Google Drive repository file changed during download".into());
        }
    }
    let mut revisions = entries;
    if let Some(entry) = manifest_entry {
        revisions.insert("manifest.json".into(), entry);
    }
    tokio::fs::write(
        stage.join(".remote-drive.json"),
        serde_json::to_vec(&revisions).map_err(|error| error.to_string())?,
    )
    .await
    .map_err(io_error)?;
    Ok((files.len(), size))
}
