use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::{
    header::{ACCEPT, AUTHORIZATION, USER_AGENT},
    Client, StatusCode,
};
use serde::{Deserialize, Serialize};

use crate::github_credentials::github_token;

const GITHUB_API_BASE: &str = "https://api.github.com";
const GITHUB_API_VERSION: &str = "2022-11-28";
const USER_AGENT_VALUE: &str = "myelin";

#[derive(Serialize)]
pub struct GitHubContentPayload {
    sha: Option<String>,
    bytes: Option<Vec<u8>>,
}

#[derive(Serialize)]
pub struct GitHubWritePayload {
    sha: String,
}

#[derive(Deserialize)]
struct GitHubContentResponse {
    sha: String,
    content: Option<String>,
}

#[derive(Deserialize)]
struct GitHubWriteResponse {
    content: GitHubWriteContent,
}

#[derive(Deserialize)]
struct GitHubWriteContent {
    sha: String,
}

#[derive(Serialize)]
struct GitHubPutRequest<'a> {
    message: &'a str,
    content: String,
    branch: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha: Option<&'a str>,
}

#[derive(Serialize)]
struct GitHubDeleteRequest<'a> {
    message: &'a str,
    sha: &'a str,
    branch: &'a str,
}

fn contents_url(owner: &str, repo: &str, path: &str) -> String {
    format!(
        "{}/repos/{}/{}/contents/{}",
        GITHUB_API_BASE, owner, repo, path
    )
}

fn github_client(token: &str) -> Result<Client, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        ACCEPT,
        "application/vnd.github+json"
            .parse()
            .map_err(|error| format!("Failed to build GitHub accept header: {}", error))?,
    );
    headers.insert(
        USER_AGENT,
        USER_AGENT_VALUE
            .parse()
            .map_err(|error| format!("Failed to build GitHub user agent header: {}", error))?,
    );
    headers.insert(
        "X-GitHub-Api-Version",
        GITHUB_API_VERSION
            .parse()
            .map_err(|error| format!("Failed to build GitHub API version header: {}", error))?,
    );
    headers.insert(
        AUTHORIZATION,
        format!("Bearer {}", token)
            .parse()
            .map_err(|error| format!("Failed to build GitHub auth header: {}", error))?,
    );

    Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|error| format!("Failed to build GitHub client: {}", error))
}

async fn response_error(prefix: &str, response: reqwest::Response) -> String {
    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "<no response body>".to_string());
    format!("{} ({}): {}", prefix, status, body)
}

#[tauri::command]
pub async fn github_get_contents(
    owner: String,
    repo: String,
    branch: String,
    credential_id: String,
    path: String,
) -> Result<GitHubContentPayload, String> {
    let token = github_token(&credential_id)?;
    let client = github_client(&token)?;
    let response = client
        .get(contents_url(&owner, &repo, &path))
        .query(&[("ref", branch.as_str())])
        .send()
        .await
        .map_err(|error| format!("GitHub contents request failed: {}", error))?;

    match response.status() {
        StatusCode::NOT_FOUND => Ok(GitHubContentPayload {
            sha: None,
            bytes: None,
        }),
        status if !status.is_success() => Err(response_error("GitHub contents request failed", response).await),
        _ => {
            let payload: GitHubContentResponse = response
                .json()
                .await
                .map_err(|error| format!("Failed to decode GitHub contents response: {}", error))?;

            let bytes = match payload.content {
                Some(content) => {
                    let normalized = content.replace('\n', "");
                    Some(
                        STANDARD
                            .decode(normalized)
                            .map_err(|error| format!("Failed to decode GitHub file content: {}", error))?,
                    )
                }
                None => None,
            };

            Ok(GitHubContentPayload {
                sha: Some(payload.sha),
                bytes,
            })
        }
    }
}

#[tauri::command]
pub async fn github_put_contents(
    owner: String,
    repo: String,
    branch: String,
    credential_id: String,
    path: String,
    bytes: Vec<u8>,
    sha: Option<String>,
    message: String,
) -> Result<GitHubWritePayload, String> {
    let token = github_token(&credential_id)?;
    let client = github_client(&token)?;
    let request = GitHubPutRequest {
        message: &message,
        content: STANDARD.encode(bytes),
        branch: &branch,
        sha: sha.as_deref(),
    };

    let response = client
        .put(contents_url(&owner, &repo, &path))
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("GitHub write request failed: {}", error))?;

    if !response.status().is_success() {
        return Err(response_error("GitHub write request failed", response).await);
    }

    let payload: GitHubWriteResponse = response
        .json()
        .await
        .map_err(|error| format!("Failed to decode GitHub write response: {}", error))?;

    Ok(GitHubWritePayload {
        sha: payload.content.sha,
    })
}

#[tauri::command]
pub async fn github_delete_contents(
    owner: String,
    repo: String,
    branch: String,
    credential_id: String,
    path: String,
    sha: String,
    message: String,
) -> Result<(), String> {
    let token = github_token(&credential_id)?;
    let client = github_client(&token)?;
    let request = GitHubDeleteRequest {
        message: &message,
        sha: &sha,
        branch: &branch,
    };

    let response = client
        .delete(contents_url(&owner, &repo, &path))
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("GitHub delete request failed: {}", error))?;

    match response.status() {
        StatusCode::NOT_FOUND => Ok(()),
        status if !status.is_success() => Err(response_error("GitHub delete request failed", response).await),
        _ => Ok(()),
    }
}
