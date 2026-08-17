//! One-shot loopback HTTP listener for the OAuth 2.0 authorization code flow.
//!
//! Google's Desktop OAuth clients only accept `http://127.0.0.1:<port>`
//! redirects, and the port is part of the authorize URL — so `oauth_loopback_start`
//! binds first and returns the port it got, and the frontend builds the URL
//! around it. The listener serves exactly one redirect, emits its query string
//! to the frontend, and stops.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub const REDIRECT_EVENT: &str = "oauth-loopback-redirect";

const RESPONSE_BODY: &str = "<!doctype html><meta charset=\"utf-8\"><title>Signed in</title>\
<body style=\"font-family:system-ui;padding:3rem;text-align:center\">\
<h1>Signed in</h1><p>You can close this tab and return to Myelin Notes.</p>";

#[derive(Default)]
pub struct OauthLoopbackState {
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl OauthLoopbackState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Installs `handle` as the live listener, aborting whichever it replaces —
    /// an abandoned sign-in must not leave a port bound.
    fn replace(&self, handle: Option<tauri::async_runtime::JoinHandle<()>>) {
        let mut slot = self.task.lock().expect("oauth loopback state poisoned");
        if let Some(previous) = std::mem::replace(&mut *slot, handle) {
            previous.abort();
        }
    }
}

/// The query string of the first request carrying one, e.g. `code=…&state=…`.
/// Browsers also probe the port for `/favicon.ico`; those carry no query and
/// are answered with 404 without ending the wait.
fn query_of(request_line: &str) -> Option<String> {
    let target = request_line.split(' ').nth(1)?;
    let query = target.split_once('?')?.1;
    if query.is_empty() {
        None
    } else {
        Some(query.to_string())
    }
}

async fn serve(app: AppHandle, listener: TcpListener) {
    loop {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };

        let mut buffer = [0u8; 4096];
        let read = stream.read(&mut buffer).await.unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..read]);
        let query = request.lines().next().and_then(query_of);

        let response = match &query {
            Some(_) => format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                RESPONSE_BODY.len(),
                RESPONSE_BODY
            ),
            None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
        };
        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.flush().await;

        if let Some(query) = query {
            let _ = app.emit(REDIRECT_EVENT, query);
            return;
        }
    }
}

/// Binds a loopback listener on an ephemeral port and returns that port.
#[tauri::command]
pub async fn oauth_loopback_start(
    app: AppHandle,
    state: State<'_, OauthLoopbackState>,
) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("Failed to bind OAuth loopback listener: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Failed to read OAuth loopback port: {error}"))?
        .port();

    state.replace(Some(tauri::async_runtime::spawn(serve(app, listener))));
    Ok(port)
}

#[tauri::command]
pub fn oauth_loopback_cancel(state: State<'_, OauthLoopbackState>) {
    state.replace(None);
}
