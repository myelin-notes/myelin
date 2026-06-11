use std::{
    collections::HashMap,
    io::{Error, ErrorKind},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{oneshot, Mutex},
};

const MCP_PROTOCOL_VERSION: &str = "2025-06-18";
const MCP_EVENT_TOOL_CALL: &str = "mcp-tool-call";
const MCP_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REQUEST_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub struct McpServerState {
    inner: Arc<McpServerInner>,
}

struct McpServerInner {
    runtime: Mutex<Option<McpServerRuntime>>,
    pending: Mutex<HashMap<String, oneshot::Sender<McpFrontendToolResponse>>>,
    next_request_id: AtomicU64,
}

struct McpServerRuntime {
    port: u16,
    shutdown: oneshot::Sender<()>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    enabled: bool,
    port: Option<u16>,
    url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpToolCallPayload {
    request_id: String,
    tool_name: String,
    arguments: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpFrontendToolResponse {
    request_id: String,
    result: Option<Value>,
    error: Option<String>,
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

impl McpServerState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(McpServerInner {
                runtime: Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
                next_request_id: AtomicU64::new(1),
            }),
        }
    }

    async fn status(&self) -> McpServerStatus {
        let runtime = self.inner.runtime.lock().await;
        if let Some(runtime) = runtime.as_ref() {
            return status_for_port(Some(runtime.port));
        }
        status_for_port(None)
    }
}

fn status_for_port(port: Option<u16>) -> McpServerStatus {
    McpServerStatus {
        enabled: port.is_some(),
        port,
        url: port.map(|port| format!("http://127.0.0.1:{port}/mcp")),
    }
}

#[tauri::command]
pub async fn mcp_start(
    app: AppHandle,
    state: State<'_, McpServerState>,
    port: u16,
) -> Result<McpServerStatus, String> {
    let mut runtime = state.inner.runtime.lock().await;
    if runtime.as_ref().is_some_and(|active| active.port == port) {
        return Ok(status_for_port(Some(port)));
    }

    if let Some(active) = runtime.take() {
        let _ = active.shutdown.send(());
    }

    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|err| format!("bind MCP server on 127.0.0.1:{port}: {err}"))?;
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    tauri::async_runtime::spawn(serve_mcp(
        listener,
        app,
        state.inner().clone(),
        shutdown_rx,
    ));
    *runtime = Some(McpServerRuntime {
        port,
        shutdown: shutdown_tx,
    });
    Ok(status_for_port(Some(port)))
}

#[tauri::command]
pub async fn mcp_stop(state: State<'_, McpServerState>) -> Result<McpServerStatus, String> {
    let mut runtime = state.inner.runtime.lock().await;
    if let Some(active) = runtime.take() {
        let _ = active.shutdown.send(());
    }
    Ok(status_for_port(None))
}

#[tauri::command]
pub async fn mcp_status(state: State<'_, McpServerState>) -> Result<McpServerStatus, String> {
    Ok(state.status().await)
}

#[tauri::command]
pub async fn mcp_respond(
    state: State<'_, McpServerState>,
    response: McpFrontendToolResponse,
) -> Result<(), String> {
    let sender = state.inner.pending.lock().await.remove(&response.request_id);
    if let Some(sender) = sender {
        sender
            .send(response)
            .map_err(|_| "MCP request receiver dropped".to_string())?;
    }
    Ok(())
}

async fn serve_mcp(
    listener: TcpListener,
    app: AppHandle,
    state: McpServerState,
    mut shutdown: oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => {
                let Ok((stream, _addr)) = accepted else {
                    continue;
                };
                tauri::async_runtime::spawn(handle_connection(
                    stream,
                    app.clone(),
                    state.clone(),
                ));
            }
        }
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    app: AppHandle,
    state: McpServerState,
) -> Result<(), Error> {
    let request = read_http_request(&mut stream).await?;
    let response = match request.method.as_str() {
        "OPTIONS" => http_response(204, "No Content", None),
        "POST" if request.path == "/mcp" => {
            let response = handle_json_rpc(app, state, &request.body).await;
            match response {
                RpcHttpResponse::Accepted => http_response(202, "Accepted", None),
                RpcHttpResponse::Json(value) => {
                    http_response(200, "OK", Some(value.to_string()))
                }
            }
        }
        _ => http_response(
            404,
            "Not Found",
            Some(json!({ "error": "Not found" }).to_string()),
        ),
    };
    stream.write_all(response.as_bytes()).await
}

enum RpcHttpResponse {
    Accepted,
    Json(Value),
}

async fn handle_json_rpc(
    app: AppHandle,
    state: McpServerState,
    body: &[u8],
) -> RpcHttpResponse {
    let request: Result<JsonRpcRequest, _> = serde_json::from_slice(body);
    let Ok(request) = request else {
        return RpcHttpResponse::Json(rpc_error(
            None,
            -32700,
            "Invalid JSON-RPC request",
        ));
    };

    if request.id.is_none() {
        return RpcHttpResponse::Accepted;
    }

    let id = request.id.clone();
    let result = match request.method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "myelin",
                "version": env!("CARGO_PKG_VERSION")
            }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": mcp_tool_definitions() })),
        "tools/call" => call_frontend_tool(app, state, request.params).await,
        _ => Err((-32601, format!("Method not found: {}", request.method))),
    };

    match result {
        Ok(value) => RpcHttpResponse::Json(rpc_success(id, value)),
        Err((code, message)) => RpcHttpResponse::Json(rpc_error(id, code, &message)),
    }
}

async fn call_frontend_tool(
    app: AppHandle,
    state: McpServerState,
    params: Option<Value>,
) -> Result<Value, (i64, String)> {
    let params = params
        .and_then(|value| value.as_object().cloned())
        .ok_or_else(|| (-32602, "tools/call requires params".to_string()))?;
    let tool_name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, "tools/call requires params.name".to_string()))?;
    let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let request_id = state
        .inner
        .next_request_id
        .fetch_add(1, Ordering::Relaxed)
        .to_string();
    let (sender, receiver) = oneshot::channel();

    state
        .inner
        .pending
        .lock()
        .await
        .insert(request_id.clone(), sender);

    let payload = McpToolCallPayload {
        request_id: request_id.clone(),
        tool_name: tool_name.to_string(),
        arguments,
    };

    if let Err(err) = app.emit(MCP_EVENT_TOOL_CALL, payload) {
        state.inner.pending.lock().await.remove(&request_id);
        return Err((-32000, format!("emit MCP tool call: {err}")));
    }

    let response = match tokio::time::timeout(MCP_REQUEST_TIMEOUT, receiver).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => return Err((-32000, "MCP tool response dropped".to_string())),
        Err(_) => {
            state.inner.pending.lock().await.remove(&request_id);
            return Err((-32000, "MCP tool response timed out".to_string()));
        }
    };

    if let Some(error) = response.error {
        return Ok(json!({
            "content": [{ "type": "text", "text": error }],
            "isError": true
        }));
    }

    let result = response.result.unwrap_or(Value::Null);
    Ok(json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).unwrap_or_else(|_| "null".to_string())
        }],
        "isError": false
    }))
}

fn rpc_success(id: Option<Value>, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "result": result
    })
}

fn rpc_error(id: Option<Value>, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": {
            "code": code,
            "message": message
        }
    })
}

fn mcp_tool_definitions() -> Value {
    json!([
        {
            "name": "list_notes",
            "description": "List Myelin canvas notes with compact metadata and previews.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "folderId": { "type": "string" },
                    "tag": { "type": "string" },
                    "limit": { "type": "number" }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "list_directory",
            "description": "List the immediate notes, files, and folders in one Myelin folder. Omit folderId for the root.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "folderId": { "type": "string" }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "read_note",
            "description": "Read structured note inventory, including page frames, floating text, assets, drawings, and cached indexed text.",
            "inputSchema": {
                "type": "object",
                "properties": { "noteId": { "type": "string" } },
                "required": ["noteId"],
                "additionalProperties": false
            }
        },
        {
            "name": "read_page_frame",
            "description": "Read full markdown and plain text for one page frame.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "noteId": { "type": "string" },
                    "pageFrameId": { "type": "string" }
                },
                "required": ["noteId", "pageFrameId"],
                "additionalProperties": false
            }
        },
        {
            "name": "read_canvas_text",
            "description": "Read one floating canvas text element.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "noteId": { "type": "string" },
                    "elementId": { "type": "string" }
                },
                "required": ["noteId", "elementId"],
                "additionalProperties": false
            }
        },
        {
            "name": "read_latex",
            "description": "Read one floating LaTeX element.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "noteId": { "type": "string" },
                    "elementId": { "type": "string" }
                },
                "required": ["noteId", "elementId"],
                "additionalProperties": false
            }
        },
        {
            "name": "read_image",
            "description": "Read metadata for one image element.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "noteId": { "type": "string" },
                    "elementId": { "type": "string" }
                },
                "required": ["noteId", "elementId"],
                "additionalProperties": false
            }
        },
        {
            "name": "read_pdf",
            "description": "Read metadata for one PDF element.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "noteId": { "type": "string" },
                    "elementId": { "type": "string" }
                },
                "required": ["noteId", "elementId"],
                "additionalProperties": false
            }
        },
        {
            "name": "read_note_full",
            "description": "Read a note inventory plus full page-frame, canvas text, and LaTeX contents.",
            "inputSchema": {
                "type": "object",
                "properties": { "noteId": { "type": "string" } },
                "required": ["noteId"],
                "additionalProperties": false
            }
        },
        {
            "name": "create_page_frame",
            "description": "Create a new page frame from markdown in an existing note.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "noteId": { "type": "string" },
                    "markdown": { "type": "string" },
                    "displayName": { "type": "string" },
                    "x": { "type": "number" },
                    "y": { "type": "number" }
                },
                "required": ["noteId", "markdown"],
                "additionalProperties": false
            }
        },
        {
            "name": "replace_page_frame_markdown",
            "description": "Replace one existing page frame with markdown.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "noteId": { "type": "string" },
                    "pageFrameId": { "type": "string" },
                    "markdown": { "type": "string" }
                },
                "required": ["noteId", "pageFrameId", "markdown"],
                "additionalProperties": false
            }
        },
        {
            "name": "create_note",
            "description": "Create a new canvas note, optionally with an initial markdown page frame.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "parentId": { "type": "string" },
                    "markdown": { "type": "string" }
                },
                "required": ["title"],
                "additionalProperties": false
            }
        },
        {
            "name": "create_folder",
            "description": "Create a new folder.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "parentId": { "type": "string" }
                },
                "required": ["name"],
                "additionalProperties": false
            }
        },
        {
            "name": "move_node",
            "description": "Move a note, file, or folder to another folder.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "nodeId": { "type": "string" },
                    "newParentId": { "type": "string" }
                },
                "required": ["nodeId"],
                "additionalProperties": false
            }
        },
        {
            "name": "delete_node",
            "description": "Delete a note, file, or folder. Requires confirm=true; non-empty folders also require recursive=true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "nodeId": { "type": "string" },
                    "confirm": { "type": "boolean" },
                    "recursive": { "type": "boolean" }
                },
                "required": ["nodeId", "confirm"],
                "additionalProperties": false
            }
        },
        {
            "name": "edit_tags",
            "description": "Edit tags on a note, file, or folder. Provide set to replace tags, or add/remove arrays for incremental edits.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "nodeId": { "type": "string" },
                    "set": { "type": "array", "items": { "type": "string" } },
                    "add": { "type": "array", "items": { "type": "string" } },
                    "remove": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["nodeId"],
                "additionalProperties": false
            }
        }
    ])
}

async fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, Error> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Err(Error::new(ErrorKind::UnexpectedEof, "closed before headers"));
        }
        buffer.extend_from_slice(&chunk[..n]);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err(Error::new(ErrorKind::InvalidData, "request too large"));
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
    };

    let header_text = std::str::from_utf8(&buffer[..header_end])
        .map_err(|err| Error::new(ErrorKind::InvalidData, err))?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| Error::new(ErrorKind::InvalidData, "missing request line"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| Error::new(ErrorKind::InvalidData, "missing method"))?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| Error::new(ErrorKind::InvalidData, "missing path"))?
        .to_string();

    let mut headers = HashMap::new();
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_REQUEST_BYTES {
        return Err(Error::new(ErrorKind::InvalidData, "request body too large"));
    }

    let mut body = buffer[header_end..].to_vec();
    if body.len() < content_length {
        body.resize(content_length, 0);
        stream
            .read_exact(&mut body[buffer.len() - header_end..])
            .await?;
    } else {
        body.truncate(content_length);
    }

    Ok(HttpRequest {
        method,
        path,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
}

fn http_response(status: u16, reason: &str, body: Option<String>) -> String {
    let body = body.unwrap_or_default();
    format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: application/json\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: content-type, mcp-protocol-version\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n{}",
        body.len(),
        body,
    )
}
