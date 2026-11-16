mod runners;

use std::collections::{HashMap, VecDeque};
use std::io::ErrorKind;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use runners::{resolve_plan, RunPlan};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncRead, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

/// How often the run loop checks for process exit while also watching for a
/// cancel signal. Keeps exit latency imperceptible without busy-spinning.
const POLL_INTERVAL: Duration = Duration::from_millis(50);
/// Retained scrollback per execution. Output beyond this evicts the oldest
/// lines; `poll_output` reports the gap as `skipped`.
const RING_CAP: usize = 10_000;
/// A line longer than this is cut and the rest of it discarded.
const MAX_LINE_BYTES: usize = 8 * 1024;
/// Cap for one display bundle line; a Plotly figure inlines ~5 MB of plotly.js.
const MAX_DISPLAY_BYTES: usize = 32 * 1024 * 1024;
/// Retained bytes per execution, so a loop of large displays can't exhaust memory.
const RING_MAX_BYTES: usize = 256 * 1024 * 1024;
/// Rich output marker written by python_bootstrap.py: `PREFIX <json bundle> BEL`.
const DISPLAY_PREFIX: &[u8] = b"\x1b]myelin;";
const DISPLAY_SUFFIX: u8 = 0x07;
const POLL_MAX_LINES: usize = 2_000;
const POLL_MAX_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum RunItem {
    Line {
        stream: OutputStream,
        text: String,
    },
    /// A MIME bundle as JSON text; parsed by the frontend.
    Display {
        bundle: String,
    },
}

impl RunItem {
    fn byte_len(&self) -> usize {
        match self {
            RunItem::Line { text, .. } => text.len(),
            RunItem::Display { bundle } => bundle.len(),
        }
    }
}

enum RunStatus {
    Running,
    Done {
        exit_code: Option<i32>,
        error: Option<String>,
    },
}

/// `total` is the cursor space: items ever produced, of which the newest
/// `items.len()` (holding `bytes`) are retained. `Done` is set only after both pipe readers hit
/// EOF, so a poll observing it knows no further lines are coming.
struct RunBuffer {
    items: VecDeque<RunItem>,
    total: u64,
    bytes: usize,
    status: RunStatus,
}

struct RunEntry {
    buffer: Arc<Mutex<RunBuffer>>,
    cancel: Option<oneshot::Sender<()>>,
}

pub struct CodeRunnerState {
    runs: Arc<Mutex<HashMap<String, RunEntry>>>,
}

impl CodeRunnerState {
    pub fn new() -> Self {
        Self {
            runs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for CodeRunnerState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn run_code(
    app: AppHandle,
    state: State<'_, CodeRunnerState>,
    execution_id: String,
    language: String,
    source: String,
) -> Result<(), String> {
    let dir = app
        .path()
        .temp_dir()
        .map_err(|e| format!("resolve temp dir: {e}"))?
        .join("myelin-run")
        .join(&execution_id);

    let Some(plan) = resolve_plan(&language, &dir) else {
        return Err(format!("Cannot run '{language}' — unsupported language."));
    };

    std::fs::create_dir_all(&dir).map_err(|e| format!("create run dir: {e}"))?;
    std::fs::write(dir.join(plan.source_filename), source)
        .map_err(|e| format!("write source: {e}"))?;
    for (name, contents) in &plan.support_files {
        std::fs::write(dir.join(name), contents).map_err(|e| format!("write {name}: {e}"))?;
    }

    let buffer = Arc::new(Mutex::new(RunBuffer {
        items: VecDeque::new(),
        total: 0,
        bytes: 0,
        status: RunStatus::Running,
    }));
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state.runs.lock().expect("runs mutex poisoned").insert(
        execution_id.clone(),
        RunEntry {
            buffer: buffer.clone(),
            cancel: Some(cancel_tx),
        },
    );

    let runs = state.runs.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_to_completion(&dir, plan, cancel_rx, &buffer).await;
        let _ = std::fs::remove_dir_all(&dir);

        buffer.lock().expect("run buffer mutex poisoned").status = match result {
            Ok(exit_code) => RunStatus::Done {
                exit_code,
                error: None,
            },
            Err(error) => RunStatus::Done {
                exit_code: None,
                error: Some(error),
            },
        };
        if let Some(entry) = runs
            .lock()
            .expect("runs mutex poisoned")
            .get_mut(&execution_id)
        {
            entry.cancel = None;
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn cancel_run(
    state: State<'_, CodeRunnerState>,
    execution_id: String,
) -> Result<(), String> {
    if let Some(entry) = state
        .runs
        .lock()
        .expect("runs mutex poisoned")
        .get_mut(&execution_id)
    {
        if let Some(tx) = entry.cancel.take() {
            let _ = tx.send(());
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollResponse {
    items: Vec<RunItem>,
    next_cursor: u64,
    /// Lines evicted from the ring before the caller's cursor reached them.
    skipped: u64,
    /// With an empty `items`, the caller has drained everything.
    finished: bool,
    exit_code: Option<i32>,
    error: Option<String>,
}

#[tauri::command]
pub async fn poll_output(
    state: State<'_, CodeRunnerState>,
    execution_id: String,
    cursor: u64,
) -> Result<PollResponse, String> {
    let buffer = state
        .runs
        .lock()
        .expect("runs mutex poisoned")
        .get(&execution_id)
        .map(|entry| entry.buffer.clone())
        .ok_or("unknown execution")?;

    let buf = buffer.lock().expect("run buffer mutex poisoned");
    let oldest = buf.total - buf.items.len() as u64;
    let start = cursor.clamp(oldest, buf.total);

    // The byte cap is checked before each push, so a single oversized display still goes out alone.
    let mut items = Vec::new();
    let mut bytes = 0usize;
    let mut index = (start - oldest) as usize;
    while index < buf.items.len() && items.len() < POLL_MAX_LINES && bytes < POLL_MAX_BYTES {
        let item = &buf.items[index];
        bytes += item.byte_len();
        items.push(item.clone());
        index += 1;
    }

    let (finished, exit_code, error) = match &buf.status {
        RunStatus::Running => (false, None, None),
        RunStatus::Done { exit_code, error } => (true, *exit_code, error.clone()),
    };
    Ok(PollResponse {
        items,
        next_cursor: oldest + index as u64,
        skipped: start.saturating_sub(cursor),
        finished,
        exit_code,
        error,
    })
}

/// Drops a finished run's buffer. The frontend calls this once its poll loop
/// has drained the run (or its block is disposed).
#[tauri::command]
pub async fn release_run(
    state: State<'_, CodeRunnerState>,
    execution_id: String,
) -> Result<(), String> {
    state
        .runs
        .lock()
        .expect("runs mutex poisoned")
        .remove(&execution_id);
    Ok(())
}

/// Frame CSP: output may load its chart libraries from a CDN. No `ipc:` source, and the app embeds
/// this page with `sandbox="allow-scripts"` (opaque origin), so output can't reach Tauri commands.
const OUTPUT_FRAME_CSP: &str =
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; \
     style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; \
     connect-src https:; worker-src blob:";

/// Serves the host page for rich HTML output on the `myelin-output` scheme, its own origin, so the
/// page's CSP (not the app's) applies. The app posts the output HTML into it.
pub fn output_frame_response() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", OUTPUT_FRAME_CSP)
        .body(include_bytes!("output_frame.html").to_vec())
        .expect("static response is valid")
}

async fn run_to_completion(
    dir: &Path,
    plan: RunPlan,
    cancel_rx: oneshot::Receiver<()>,
    buffer: &Arc<Mutex<RunBuffer>>,
) -> Result<Option<i32>, String> {
    if !plan.build.is_empty() {
        let Some(output) = try_build(dir, &plan.build).await? else {
            let names = plan
                .build
                .iter()
                .map(|c| c.program.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!("No compiler found — install one of: {names}."));
        };
        for line in String::from_utf8_lossy(&output.stderr).lines() {
            push_item(
                buffer,
                RunItem::Line {
                    stream: OutputStream::Stderr,
                    text: line.to_string(),
                },
            );
        }
        if !output.status.success() {
            return Ok(output.status.code());
        }
    }

    let mut child = Command::new(&plan.run.program)
        .args(&plan.run.args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| spawn_error(&plan.run.program, e))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let out_task =
        tauri::async_runtime::spawn(drain_reader(stdout, OutputStream::Stdout, buffer.clone()));
    let err_task =
        tauri::async_runtime::spawn(drain_reader(stderr, OutputStream::Stderr, buffer.clone()));

    let status = wait_or_cancel(&mut child, cancel_rx).await?;

    // Drain fully before the caller flips status to Done — a poll observing
    // `finished` must be able to trust that no more lines are coming.
    let _ = out_task.await;
    let _ = err_task.await;

    Ok(status)
}

/// Runs the first build candidate that is present on PATH. Returns its output
/// (whether it compiled or reported errors), or `None` if no candidate compiler
/// was found.
async fn try_build(
    dir: &Path,
    candidates: &[runners::CommandSpec],
) -> Result<Option<std::process::Output>, String> {
    for spec in candidates {
        match Command::new(&spec.program)
            .args(&spec.args)
            .current_dir(dir)
            .output()
            .await
        {
            Ok(output) => return Ok(Some(output)),
            Err(e) if e.kind() == ErrorKind::NotFound => continue,
            Err(e) => return Err(spawn_error(&spec.program, e)),
        }
    }
    Ok(None)
}

/// Waits for the process to exit, killing it if a cancel signal arrives first.
/// Polls `try_wait` so the cancel future never has to share a borrow of `child`
/// with `wait`.
async fn wait_or_cancel(
    child: &mut tokio::process::Child,
    cancel_rx: oneshot::Receiver<()>,
) -> Result<Option<i32>, String> {
    tokio::pin!(cancel_rx);

    loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("poll process: {e}"))? {
            return Ok(status.code());
        }

        tokio::select! {
            _ = tokio::time::sleep(POLL_INTERVAL) => {}
            _ = &mut cancel_rx => {
                let _ = child.kill().await;
                let status = child.wait().await.map_err(|e| format!("wait after kill: {e}"))?;
                return Ok(status.code());
            }
        }
    }
}

/// Reads a pipe to EOF into the ring at full speed — the child never blocks on
/// a slow consumer; the ring drops the middle instead. Splits on `\r` as well
/// as `\n` so `\r`-rewriting progress bars stream rather than buffering one
/// giant line for the whole run. Stdout lines carrying the display marker
/// become `Display` items and get the larger display cap.
async fn drain_reader<R: AsyncRead + Unpin + Send + 'static>(
    reader: R,
    stream: OutputStream,
    buffer: Arc<Mutex<RunBuffer>>,
) {
    let mut reader = BufReader::new(reader);
    let mut chunk = vec![0u8; 16 * 1024];
    let mut pending: Vec<u8> = Vec::new();
    let mut truncated = false;
    let mut last_was_cr = false;

    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        for &byte in &chunk[..read] {
            if byte == b'\n' && last_was_cr {
                last_was_cr = false;
                continue;
            }
            last_was_cr = byte == b'\r';
            if byte == b'\n' || byte == b'\r' {
                push_item(&buffer, finish_item(stream, &mut pending, &mut truncated));
            } else if truncated {
                // Discarding the rest of an over-long line.
            } else if pending.len() >= line_limit(stream, &pending) {
                truncated = true;
            } else {
                pending.push(byte);
            }
        }
    }

    if !pending.is_empty() || truncated {
        push_item(&buffer, finish_item(stream, &mut pending, &mut truncated));
    }
}

fn is_display(stream: OutputStream, pending: &[u8]) -> bool {
    matches!(stream, OutputStream::Stdout) && pending.starts_with(DISPLAY_PREFIX)
}

fn line_limit(stream: OutputStream, pending: &[u8]) -> usize {
    if is_display(stream, pending) {
        MAX_DISPLAY_BYTES
    } else {
        MAX_LINE_BYTES
    }
}

fn finish_item(stream: OutputStream, pending: &mut Vec<u8>, truncated: &mut bool) -> RunItem {
    let item = if is_display(stream, pending) {
        match (*truncated, &pending[DISPLAY_PREFIX.len()..]) {
            (false, [json @ .., DISPLAY_SUFFIX]) => RunItem::Display {
                bundle: String::from_utf8_lossy(json).into_owned(),
            },
            _ => RunItem::Line {
                stream: OutputStream::Stderr,
                text: format!(
                    "[display output dropped: over {} MB or malformed]",
                    MAX_DISPLAY_BYTES / (1024 * 1024)
                ),
            },
        }
    } else {
        let mut text = String::from_utf8_lossy(pending).into_owned();
        if *truncated {
            text.push_str(" … [truncated]");
        }
        RunItem::Line { stream, text }
    };
    pending.clear();
    *truncated = false;
    item
}

fn push_item(buffer: &Mutex<RunBuffer>, item: RunItem) {
    let mut buf = buffer.lock().expect("run buffer mutex poisoned");
    let size = item.byte_len();
    while !buf.items.is_empty()
        && (buf.items.len() == RING_CAP || buf.bytes + size > RING_MAX_BYTES)
    {
        let evicted = buf.items.pop_front().expect("non-empty");
        buf.bytes -= evicted.byte_len();
    }
    buf.bytes += size;
    buf.items.push_back(item);
    buf.total += 1;
}

fn spawn_error(program: &str, error: std::io::Error) -> String {
    if error.kind() == ErrorKind::NotFound {
        format!("`{program}` not found — install it to run this block.")
    } else {
        format!("failed to start `{program}`: {error}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn drain(stream: OutputStream, input: Vec<u8>) -> Vec<RunItem> {
        let buffer = Arc::new(Mutex::new(RunBuffer {
            items: VecDeque::new(),
            total: 0,
            bytes: 0,
            status: RunStatus::Running,
        }));
        drain_reader(std::io::Cursor::new(input), stream, buffer.clone()).await;
        let items = buffer.lock().unwrap().items.iter().cloned().collect();
        items
    }

    #[tokio::test]
    async fn display_marker_survives_line_cap_and_keeps_order() {
        let json = format!(
            "{{\"data\":{{\"text/html\":\"{}\"}}}}",
            "x".repeat(MAX_LINE_BYTES * 4)
        );
        let mut input = b"before\n".to_vec();
        input.extend_from_slice(DISPLAY_PREFIX);
        input.extend_from_slice(json.as_bytes());
        input.extend_from_slice(b"\x07\nafter\n");

        let items = drain(OutputStream::Stdout, input).await;
        assert!(matches!(&items[0], RunItem::Line { text, .. } if text == "before"));
        assert!(matches!(&items[1], RunItem::Display { bundle } if *bundle == json));
        assert!(matches!(&items[2], RunItem::Line { text, .. } if text == "after"));
    }

    #[tokio::test]
    async fn display_marker_on_stderr_is_plain_text() {
        let mut input = DISPLAY_PREFIX.to_vec();
        input.extend_from_slice(b"{}\x07\n");
        let items = drain(OutputStream::Stderr, input).await;
        assert!(matches!(&items[0], RunItem::Line { .. }));
    }
}
