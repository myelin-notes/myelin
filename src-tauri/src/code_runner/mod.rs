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
const POLL_MAX_LINES: usize = 2_000;
const POLL_MAX_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum OutputStream {
    Stdout,
    Stderr,
}

// Jupyter-style rich output would generalize this into an item enum (text line | MIME display
// bundle | display update); the ring + cursor polling transport stays the same.
#[derive(Clone, Serialize)]
struct RunLine {
    stream: OutputStream,
    text: String,
}

enum RunStatus {
    Running,
    Done {
        exit_code: Option<i32>,
        error: Option<String>,
    },
}

/// `total` is the cursor space: lines ever produced, of which the newest
/// `lines.len()` are retained. `Done` is set only after both pipe readers hit
/// EOF, so a poll observing it knows no further lines are coming.
struct RunBuffer {
    lines: VecDeque<RunLine>,
    total: u64,
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

    let buffer = Arc::new(Mutex::new(RunBuffer {
        lines: VecDeque::new(),
        total: 0,
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
    lines: Vec<RunLine>,
    next_cursor: u64,
    /// Lines evicted from the ring before the caller's cursor reached them.
    skipped: u64,
    /// With an empty `lines`, the caller has drained everything.
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
    let oldest = buf.total - buf.lines.len() as u64;
    let start = cursor.clamp(oldest, buf.total);

    let mut lines = Vec::new();
    let mut bytes = 0usize;
    let mut index = (start - oldest) as usize;
    while index < buf.lines.len() && lines.len() < POLL_MAX_LINES && bytes < POLL_MAX_BYTES {
        let line = &buf.lines[index];
        bytes += line.text.len();
        lines.push(line.clone());
        index += 1;
    }

    let (finished, exit_code, error) = match &buf.status {
        RunStatus::Running => (false, None, None),
        RunStatus::Done { exit_code, error } => (true, *exit_code, error.clone()),
    };
    Ok(PollResponse {
        lines,
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
            push_line(buffer, OutputStream::Stderr, line.to_string());
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
/// giant line for the whole run.
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
                push_line(&buffer, stream, finish_line(&mut pending, &mut truncated));
            } else if truncated {
                // Discarding the rest of an over-long line.
            } else if pending.len() >= MAX_LINE_BYTES {
                truncated = true;
            } else {
                pending.push(byte);
            }
        }
    }

    if !pending.is_empty() || truncated {
        push_line(&buffer, stream, finish_line(&mut pending, &mut truncated));
    }
}

fn finish_line(pending: &mut Vec<u8>, truncated: &mut bool) -> String {
    let mut text = String::from_utf8_lossy(pending).into_owned();
    if *truncated {
        text.push_str(" … [truncated]");
    }
    pending.clear();
    *truncated = false;
    text
}

fn push_line(buffer: &Mutex<RunBuffer>, stream: OutputStream, text: String) {
    let mut buf = buffer.lock().expect("run buffer mutex poisoned");
    if buf.lines.len() == RING_CAP {
        buf.lines.pop_front();
    }
    buf.lines.push_back(RunLine { stream, text });
    buf.total += 1;
}

fn spawn_error(program: &str, error: std::io::Error) -> String {
    if error.kind() == ErrorKind::NotFound {
        format!("`{program}` not found — install it to run this block.")
    } else {
        format!("failed to start `{program}`: {error}")
    }
}
