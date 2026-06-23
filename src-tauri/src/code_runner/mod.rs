mod runners;

use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use runners::{resolve_plan, RunPlan};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

const OUTPUT_EVENT: &str = "code-run-output";
const FINISHED_EVENT: &str = "code-run-finished";
/// How often the run loop checks for process exit while also watching for a
/// cancel signal. Keeps exit latency imperceptible without busy-spinning.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputPayload {
    execution_id: String,
    stream: OutputStream,
    chunk: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FinishedPayload {
    execution_id: String,
    exit_code: Option<i32>,
    error: Option<String>,
}

pub struct CodeRunnerState {
    cancels: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

impl CodeRunnerState {
    pub fn new() -> Self {
        Self {
            cancels: Arc::new(Mutex::new(HashMap::new())),
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
        let _ = app.emit(
            FINISHED_EVENT,
            FinishedPayload {
                execution_id,
                exit_code: None,
                error: Some(format!("Cannot run '{language}' — unsupported language.")),
            },
        );
        return Ok(());
    };

    std::fs::create_dir_all(&dir).map_err(|e| format!("create run dir: {e}"))?;
    std::fs::write(dir.join(plan.source_filename), source)
        .map_err(|e| format!("write source: {e}"))?;

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state
        .cancels
        .lock()
        .expect("cancels mutex poisoned")
        .insert(execution_id.clone(), cancel_tx);

    let cancels = state.cancels.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_to_completion(&app, &dir, plan, cancel_rx, &execution_id).await;

        cancels
            .lock()
            .expect("cancels mutex poisoned")
            .remove(&execution_id);
        let _ = std::fs::remove_dir_all(&dir);

        let payload = match result {
            Ok(exit_code) => FinishedPayload {
                execution_id,
                exit_code,
                error: None,
            },
            Err(error) => FinishedPayload {
                execution_id,
                exit_code: None,
                error: Some(error),
            },
        };
        let _ = app.emit(FINISHED_EVENT, payload);
    });

    Ok(())
}

#[tauri::command]
pub async fn cancel_run(
    state: State<'_, CodeRunnerState>,
    execution_id: String,
) -> Result<(), String> {
    if let Some(tx) = state
        .cancels
        .lock()
        .expect("cancels mutex poisoned")
        .remove(&execution_id)
    {
        let _ = tx.send(());
    }
    Ok(())
}

async fn run_to_completion(
    app: &AppHandle,
    dir: &Path,
    plan: RunPlan,
    cancel_rx: oneshot::Receiver<()>,
    execution_id: &str,
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
        if !output.stderr.is_empty() {
            emit_chunk(
                app,
                execution_id,
                OutputStream::Stderr,
                &String::from_utf8_lossy(&output.stderr),
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
    let out_task = spawn_reader(
        app.clone(),
        execution_id.to_string(),
        OutputStream::Stdout,
        stdout,
    );
    let err_task = spawn_reader(
        app.clone(),
        execution_id.to_string(),
        OutputStream::Stderr,
        stderr,
    );

    let status = wait_or_cancel(&mut child, cancel_rx).await?;

    // Let the readers drain any buffered output before the finished event.
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

fn spawn_reader<R: AsyncRead + Unpin + Send + 'static>(
    app: AppHandle,
    execution_id: String,
    stream: OutputStream,
    reader: R,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit(
                OUTPUT_EVENT,
                OutputPayload {
                    execution_id: execution_id.clone(),
                    stream,
                    chunk: line,
                },
            );
        }
    })
}

fn emit_chunk(app: &AppHandle, execution_id: &str, stream: OutputStream, text: &str) {
    let _ = app.emit(
        OUTPUT_EVENT,
        OutputPayload {
            execution_id: execution_id.to_string(),
            stream,
            chunk: text.to_string(),
        },
    );
}

fn spawn_error(program: &str, error: std::io::Error) -> String {
    if error.kind() == ErrorKind::NotFound {
        format!("`{program}` not found — install it to run this block.")
    } else {
        format!("failed to start `{program}`: {error}")
    }
}
