use std::{collections::HashMap, convert::Infallible, sync::Arc, time::Duration};

use bytes::Bytes;
use http_body_util::Full;
use hyper::{
    header, server::conn::http1, service::service_fn, Method, Request, Response, StatusCode,
};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex},
};

/// How long the loopback listener stays open waiting for the browser to come
/// back. Authorization codes are short lived, so a user who wanders off
/// mid-sign-in is better served by a clean timeout than a socket held open.
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);
const CALLBACK_PATH: &str = "/oauth/callback";

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
    let page = Arc::new(page);
    let mut result = Some(result);
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => {
                let Ok((stream, _addr)) = accepted else {
                    continue;
                };
                let captured = Arc::new(Mutex::new(None));
                let service = service_fn(|request| {
                    let page = Arc::clone(&page);
                    let captured = Arc::clone(&captured);
                    async move { Ok::<_, Infallible>(respond(request, &page, &captured).await) }
                });
                // One request per connection: the browser reconnects for the
                // redirect, and this keeps `serve_connection` from parking on a
                // kept-alive socket after the callback has already arrived.
                let _ = http1::Builder::new()
                    .keep_alive(false)
                    .serve_connection(TokioIo::new(stream), service)
                    .await;
                // Browsers also request /favicon.ico against the callback
                // origin, so keep listening until a request actually carries
                // the redirect parameters.
                let params = captured.lock().await.take();
                if let Some(params) = params {
                    if let Some(sender) = result.take() {
                        let _ = sender.send(params);
                    }
                    break;
                }
            }
        }
    }
}

/// Answers a single request, recording the parameters in `captured` when the
/// request is the awaited redirect. Anything else gets a bare 404 so favicon
/// probes and stray local connections don't end the wait.
async fn respond(
    request: Request<hyper::body::Incoming>,
    page: &str,
    captured: &Mutex<Option<CallbackParams>>,
) -> Response<Full<Bytes>> {
    let params = (request.method() == Method::GET && request.uri().path() == CALLBACK_PATH)
        .then(|| parse_callback_params(request.uri().query().unwrap_or_default()))
        .filter(|params| params.code.is_some() || params.error.is_some());

    let Some(params) = params else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Full::default())
            .expect("static 404 response is valid");
    };

    *captured.lock().await = Some(params);
    Response::builder()
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Full::new(Bytes::from(page.to_owned())))
        .expect("static callback response is valid")
}

fn parse_callback_params(query: &str) -> CallbackParams {
    let mut entries: HashMap<String, String> = form_urlencoded::parse(query.as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();

    CallbackParams {
        code: entries.remove("code"),
        state: entries.remove("state"),
        error: entries.remove("error"),
        error_description: entries.remove("error_description"),
    }
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
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
    };

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
    fn decoding_leaves_trailing_escapes_alone() {
        assert_eq!(parse_callback_params("code=a%2").code.as_deref(), Some("a%2"));
        assert_eq!(parse_callback_params("code=a%zz").code.as_deref(), Some("a%zz"));
        assert_eq!(
            parse_callback_params("code=a%20b").code.as_deref(),
            Some("a b")
        );
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
