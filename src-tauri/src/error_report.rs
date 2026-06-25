use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Event carrying a Rust background-task failure to the frontend. The JS listener
/// forwards it to the shared logger, which writes the log file and reports to
/// PostHog — the same sink IPC-path failures already reach via their invoke
/// rejection.
pub const RUST_ERROR_EVENT: &str = "rust-error";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RustErrorPayload {
    subsystem: String,
    message: String,
    detail: String,
}

/// Report a failure that happens off the IPC request path — spawned workers,
/// event emitters, anything with no `Result` to return to a caller. Prints to
/// stderr for local debugging and emits [`RUST_ERROR_EVENT`] so the failure
/// still lands in the log file and PostHog. `subsystem` groups the error (it
/// becomes the JS logger subsystem); `detail` is the underlying cause.
pub fn report_error(
    app: &AppHandle,
    subsystem: &str,
    message: &str,
    detail: impl std::fmt::Display,
) {
    let detail = detail.to_string();
    eprintln!("{subsystem}: {message}: {detail}");
    let _ = app.emit(
        RUST_ERROR_EVENT,
        RustErrorPayload {
            subsystem: subsystem.to_string(),
            message: message.to_string(),
            detail,
        },
    );
}
