use std::{collections::HashMap, sync::Arc, time::Duration};

use serde::Serialize;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{oneshot, Mutex},
};

/// How long the loopback listener stays open waiting for the browser to come
/// back. Authorization codes are short lived, so a user who wanders off
/// mid-sign-in is better served by a clean timeout than a socket held open.
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);
const CALLBACK_PATH: &str = "/oauth/callback";
const MAX_REQUEST_BYTES: usize = 8 * 1024;

#[derive(Default)]
pub struct OAuthLoopbackState {
    pending: Arc<Mutex<Option<PendingCallback>>>,
}

impl OAuthLoopbackState {
    pub fn new() -> Self {
        Self::default()
    }
}

struct PendingCallback {
    shutdown: oneshot::Sender<()>,
    result: oneshot::Receiver<CallbackParams>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallbackParams {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackStart {
    redirect_uri: String,
}

/// Binds an ephemeral loopback port and returns the redirect URI to hand to the
/// authorization server. GitHub allows any port for a `127.0.0.1` callback URL,
/// so nothing has to be reserved ahead of time.
///
/// `title` and `message` are rendered on the page the browser lands on once the
/// redirect arrives; the caller passes them already localized.
#[tauri::command]
pub async fn oauth_loopback_start(
    state: tauri::State<'_, OAuthLoopbackState>,
    title: String,
    message: String,
) -> Result<LoopbackStart, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|err| format!("bind OAuth loopback server: {err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("read OAuth loopback port: {err}"))?
        .port();

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let (result_tx, result_rx) = oneshot::channel();
    tauri::async_runtime::spawn(serve(
        listener,
        callback_page(&title, &message),
        result_tx,
        shutdown_rx,
    ));

    let previous = state.pending.lock().await.replace(PendingCallback {
        shutdown: shutdown_tx,
        result: result_rx,
    });
    if let Some(previous) = previous {
        let _ = previous.shutdown.send(());
    }

    Ok(LoopbackStart {
        redirect_uri: format!("http://127.0.0.1:{port}{CALLBACK_PATH}"),
    })
}

/// Resolves once the browser hits the loopback callback, or errors on timeout.
/// Validating `state` against what was sent is the caller's job.
#[tauri::command]
pub async fn oauth_loopback_wait(
    state: tauri::State<'_, OAuthLoopbackState>,
) -> Result<CallbackParams, String> {
    let pending = state
        .pending
        .lock()
        .await
        .take()
        .ok_or_else(|| "No OAuth loopback server is listening.".to_string())?;

    match tokio::time::timeout(CALLBACK_TIMEOUT, pending.result).await {
        Ok(Ok(params)) => Ok(params),
        Ok(Err(_)) => Err("OAuth loopback server stopped before the browser returned.".to_string()),
        Err(_) => {
            let _ = pending.shutdown.send(());
            Err("Timed out waiting for the browser to finish sign-in.".to_string())
        }
    }
}

#[tauri::command]
pub async fn oauth_loopback_cancel(
    state: tauri::State<'_, OAuthLoopbackState>,
) -> Result<(), String> {
    if let Some(pending) = state.pending.lock().await.take() {
        let _ = pending.shutdown.send(());
    }
    Ok(())
}

async fn serve(
    listener: TcpListener,
    page: String,
    result: oneshot::Sender<CallbackParams>,
    mut shutdown: oneshot::Receiver<()>,
) {
    let mut result = Some(result);
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => {
                let Ok((stream, _addr)) = accepted else {
                    continue;
                };
                // Browsers also request /favicon.ico against the callback
                // origin, so keep listening until a request actually carries
                // the redirect parameters.
                if let Some(params) = handle_connection(stream, &page).await {
                    if let Some(sender) = result.take() {
                        let _ = sender.send(params);
                    }
                    break;
                }
            }
        }
    }
}

async fn handle_connection(mut stream: TcpStream, page: &str) -> Option<CallbackParams> {
    let query = read_request_query(&mut stream).await?;
    let params = parse_callback_params(&query);
    let complete = params.code.is_some() || params.error.is_some();

    let body = if complete { page } else { "" };
    let response = format!(
        "HTTP/1.1 {}\r\n\
         Content-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n{}",
        if complete { "200 OK" } else { "404 Not Found" },
        body.len(),
        body,
    );
    let _ = stream.write_all(response.as_bytes()).await;

    complete.then_some(params)
}

/// Reads just the request line and returns its query string. The callback is a
/// bare GET, so headers and body are irrelevant.
async fn read_request_query(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    let line_end = loop {
        if let Some(index) = buffer.windows(2).position(|window| window == b"\r\n") {
            break index;
        }
        if buffer.len() > MAX_REQUEST_BYTES {
            return None;
        }
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => return None,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
        }
    };

    let line = String::from_utf8_lossy(&buffer[..line_end]).into_owned();
    let mut parts = line.split(' ');
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    (path == CALLBACK_PATH).then(|| query.to_string())
}

fn parse_callback_params(query: &str) -> CallbackParams {
    let mut entries: HashMap<&str, String> = HashMap::new();
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        entries.insert(key, percent_decode(value));
    }

    CallbackParams {
        code: entries.remove("code"),
        state: entries.remove("state"),
        error: entries.remove("error"),
        error_description: entries.remove("error_description"),
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' if index + 3 <= bytes.len() => {
                match u8::from_str_radix(&value[index + 1..index + 3], 16) {
                    Ok(decoded) => {
                        out.push(decoded);
                        index += 3;
                    }
                    Err(_) => {
                        out.push(b'%');
                        index += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn callback_page(title: &str, message: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
         <title>{title}</title></head>\
         <body style=\"margin:0;display:grid;place-items:center;min-height:100vh;\
         font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0f0f11;color:#f4f4f5\">\
         <main style=\"text-align:center;padding:2rem\">\
         <h1 style=\"font-size:1.25rem;font-weight:600;margin:0 0 .5rem\">{title}</h1>\
         <p style=\"margin:0;opacity:.65;font-size:.875rem\">{message}</p>\
         </main></body></html>",
        title = escape_html(title),
        message = escape_html(message),
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_code_and_state() {
        let params = parse_callback_params("code=abc123&state=xyz");
        assert_eq!(params.code.as_deref(), Some("abc123"));
        assert_eq!(params.state.as_deref(), Some("xyz"));
        assert!(params.error.is_none());
    }

    #[test]
    fn parses_error_with_encoded_description() {
        let params =
            parse_callback_params("error=access_denied&error_description=The+user+said+no%21");
        assert_eq!(params.error.as_deref(), Some("access_denied"));
        assert_eq!(
            params.error_description.as_deref(),
            Some("The user said no!")
        );
    }

    #[test]
    fn empty_query_yields_nothing_actionable() {
        let params = parse_callback_params("");
        assert!(params.code.is_none() && params.error.is_none());
    }

    #[test]
    fn percent_decode_leaves_trailing_escapes_alone() {
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("a%zz"), "a%zz");
        assert_eq!(percent_decode("a%20b"), "a b");
    }

    #[tokio::test]
    async fn serves_the_redirect_and_ignores_unrelated_requests() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (result_tx, result_rx) = oneshot::channel();
        let (_shutdown_tx, shutdown_rx) = oneshot::channel();
        tokio::spawn(serve(
            listener,
            callback_page("done", "close me"),
            result_tx,
            shutdown_rx,
        ));

        // A favicon probe must not end the wait.
        request(port, "GET /favicon.ico HTTP/1.1\r\n\r\n").await;

        let response = request(
            port,
            &format!("GET {CALLBACK_PATH}?code=abc&state=xyz HTTP/1.1\r\n\r\n"),
        )
        .await;
        assert!(response.contains("200 OK"));
        assert!(response.contains("close me"));

        let params = result_rx.await.unwrap();
        assert_eq!(params.code.as_deref(), Some("abc"));
        assert_eq!(params.state.as_deref(), Some("xyz"));
    }

    async fn request(port: u16, raw: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream.write_all(raw.as_bytes()).await.unwrap();
        let mut response = String::new();
        let mut buffer = [0_u8; 1024];
        while let Ok(read) = stream.read(&mut buffer).await {
            if read == 0 {
                break;
            }
            response.push_str(&String::from_utf8_lossy(&buffer[..read]));
        }
        response
    }

    #[test]
    fn escapes_page_copy() {
        let page = callback_page("<b>t</b>", "a & b");
        assert!(page.contains("&lt;b&gt;t&lt;/b&gt;"));
        assert!(page.contains("a &amp; b"));
    }
}
