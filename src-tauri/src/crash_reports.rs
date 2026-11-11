use crate::android_exit::ExitDetails;
use crate::native_crash::{self, CrashWriter};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    id: String,
    kind: String,
    reason: String,
    app_version: String,
    platform: String,
    timestamp: String,
    distinct_id: Option<String>,
    session_id: Option<String>,
    code: u64,
    detail: String,
    address: String,
    #[serde(default)]
    panics: Option<String>,
    #[serde(default)]
    pid: Option<u32>,
    #[serde(default, skip_deserializing)]
    exit: Option<ExitDetails>,
}

const MAX_PANICS: usize = 4;
const MAX_PANIC_CHARS: usize = 2048;
// Pids get reused, so an exit only belongs to a report if it happened around the crash.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
const EXIT_MATCH_WINDOW_MS: i64 = 60_000;

pub struct CrashReports(Mutex<ReportStore>);

struct ReportStore {
    directory: PathBuf,
    consent_path: PathBuf,
    current: CrashReport,
    pending: Vec<CrashReport>,
    enabled: Arc<AtomicBool>,
    #[cfg(not(target_os = "ios"))]
    _handler: Option<crash_handler::CrashHandler>,
}

impl ReportStore {
    fn new(data_dir: &Path, app_version: &str) -> Result<Self, String> {
        let directory = data_dir.join("crash-reports");
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let consent_path = data_dir.join("crash-reporting-consent");
        let enabled = Arc::new(AtomicBool::new(
            fs::read(&consent_path).ok().as_deref() == Some(b"enabled"),
        ));
        let mut pending = Vec::new();
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.extension().and_then(|value| value.to_str()) == Some("bin")
                && !path.with_extension("json").exists()
            {
                if let Ok(file) = OpenOptions::new().read(true).write(true).open(&path) {
                    if file.try_lock().is_ok() {
                        let _ = fs::remove_file(&path);
                    }
                }
            }
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Ok(mut report) = serde_json::from_slice::<CrashReport>(
                &fs::read(&path).map_err(|error| error.to_string())?,
            ) else {
                eprintln!("could not read saved crash report: {}", path.display());
                continue;
            };
            if uuid::Uuid::parse_str(&report.id).is_err()
                || path.file_stem().and_then(|value| value.to_str()) != Some(&report.id)
            {
                continue;
            }
            if report.kind == "native_crash" {
                let Ok(journal) = OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(path.with_extension("bin"))
                else {
                    continue;
                };
                // Another running instance owns its journal; only recover reports after its process has exited.
                if journal.try_lock().is_err() {
                    continue;
                }
                let bytes = fs::read(path.with_extension("bin")).unwrap_or_default();
                if bytes.len() < 32 {
                    fs::remove_file(&path).map_err(|error| error.to_string())?;
                    let _ = fs::remove_file(path.with_extension("bin"));
                    let _ = fs::remove_file(path.with_extension("panics"));
                    continue;
                }
                let values = [0, 8, 16, 24].map(|offset| {
                    u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
                });
                report.timestamp = chrono::DateTime::from_timestamp(values[0] as i64, 0)
                    .ok_or("invalid crash timestamp")?
                    .to_rfc3339();
                report.code = values[1];
                report.detail = format!("{:#x}", values[2]);
                report.address = format!("{:#x}", values[3]);
                report.reason = native_reason(&report.platform, report.code);
                report.panics = fs::read_to_string(path.with_extension("panics")).ok();
            }
            pending.push(report);
        }
        let current = CrashReport {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "native_crash".to_string(),
            reason: String::new(),
            app_version: app_version.to_string(),
            platform: std::env::consts::OS.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            distinct_id: None,
            session_id: None,
            code: 0,
            detail: "0x0".to_string(),
            address: "0x0".to_string(),
            panics: None,
            pid: Some(std::process::id()),
            exit: None,
        };
        let file = OpenOptions::new()
            .create_new(true)
            .read(true)
            .append(true)
            .open(directory.join(format!("{}.bin", current.id)))
            .map_err(|error| error.to_string())?;
        file.try_lock().map_err(|error| error.to_string())?;
        let store = Self {
            directory,
            consent_path,
            current,
            pending,
            enabled: enabled.clone(),
            #[cfg(not(target_os = "ios"))]
            _handler: None,
        };
        store.save(&store.current)?;
        install_panic_hook(
            store.directory.join(format!("{}.panics", store.current.id)),
            store.enabled.clone(),
        );
        #[cfg(not(target_os = "ios"))]
        {
            Ok(Self {
                _handler: Some(native_crash::install(CrashWriter { file, enabled })?),
                ..store
            })
        }
        #[cfg(target_os = "ios")]
        {
            native_crash::install(CrashWriter { file, enabled })?;
            Ok(store)
        }
    }

    fn save(&self, report: &CrashReport) -> Result<(), String> {
        let path = self.directory.join(format!("{}.json", report.id));
        let temporary = path.with_extension("tmp");
        fs::write(
            &temporary,
            serde_json::to_vec(report).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        fs::rename(temporary, path).map_err(|error| error.to_string())
    }

    fn configure(
        &mut self,
        enabled: bool,
        distinct_id: Option<String>,
        session_id: Option<String>,
    ) -> Result<Vec<CrashReport>, String> {
        self.enabled.store(false, Ordering::SeqCst);
        fs::write(
            &self.consent_path,
            if enabled {
                b"enabled".as_slice()
            } else {
                b"disabled".as_slice()
            },
        )
        .map_err(|error| error.to_string())?;
        if !enabled {
            for entry in fs::read_dir(&self.directory).map_err(|error| error.to_string())? {
                let path = entry.map_err(|error| error.to_string())?.path();
                if path == self.directory.join(format!("{}.bin", self.current.id)) {
                    continue;
                }
                fs::remove_file(path).map_err(|error| error.to_string())?;
            }
            self.pending.clear();
            return Ok(Vec::new());
        }
        self.current.distinct_id = distinct_id;
        self.current.session_id = session_id;
        self.save(&self.current)?;
        self.enabled.store(true, Ordering::SeqCst);
        Ok(self.pending.clone())
    }

    fn acknowledge(&mut self, id: &str) -> Result<(), String> {
        let Some(index) = self.pending.iter().position(|report| report.id == id) else {
            return Ok(());
        };
        fs::remove_file(self.directory.join(format!("{id}.json")))
            .map_err(|error| error.to_string())?;
        let _ = fs::remove_file(self.directory.join(format!("{id}.bin")));
        let _ = fs::remove_file(self.directory.join(format!("{id}.panics")));
        self.pending.remove(index);
        Ok(())
    }

    fn webview_terminated(&self, label: &str, reason: &str) -> Result<(), String> {
        if !self.enabled.load(Ordering::SeqCst) {
            return Ok(());
        }
        let report = CrashReport {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "webview_termination".to_string(),
            reason: format!("WebView {label} content process terminated: {reason}"),
            timestamp: chrono::Utc::now().to_rfc3339(),
            ..self.current.clone()
        };
        self.save(&report)
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn attach_exits(reports: &mut [CrashReport], exits: &[(u32, i64, ExitDetails)]) {
    for report in reports
        .iter_mut()
        .filter(|report| report.kind == "native_crash")
    {
        let Ok(crashed) = chrono::DateTime::parse_from_rfc3339(&report.timestamp) else {
            continue;
        };
        report.exit = exits
            .iter()
            .find(|(pid, at, _)| {
                Some(*pid) == report.pid
                    && (at - crashed.timestamp_millis()).abs() < EXIT_MATCH_WINDOW_MS
            })
            .map(|(_, _, details)| details.clone());
    }
}

// A panic that aborts leaves nothing else behind: stderr goes nowhere on Android and stripped builds
// can't name frames. Most panics are caught by their task, so reports only read this after a crash.
fn install_panic_hook(path: PathBuf, enabled: Arc<AtomicBool>) {
    let previous = std::panic::take_hook();
    let recent = Mutex::new(Vec::new());
    std::panic::set_hook(Box::new(move |info| {
        if enabled.load(Ordering::Relaxed) {
            if let Ok(mut recent) = recent.try_lock() {
                // Keeps the first panic, often the root cause, and the latest, which is what aborted.
                if recent.len() == MAX_PANICS {
                    recent.remove(1);
                }
                let thread = std::thread::current();
                let entry = format!(
                    "{} [{}] {info}",
                    chrono::Utc::now().to_rfc3339(),
                    thread.name().unwrap_or("unnamed"),
                );
                recent.push(entry.chars().take(MAX_PANIC_CHARS).collect::<String>());
                let _ = fs::write(&path, recent.join("\n"));
            }
        }
        previous(info);
    }));
}

fn native_reason(platform: &str, code: u64) -> String {
    let reason = match (platform, code) {
        ("macos", 1) => "Invalid memory access",
        ("macos", 2) => "Illegal instruction",
        ("macos", 3) => "Arithmetic exception",
        ("macos", 5) => "Software exception / abort",
        ("macos", 6) => "Breakpoint / trap",
        ("windows", 0xc0000005) => "Access violation",
        ("windows", 0xc00000fd) => "Stack overflow",
        ("windows", 0xc000001d) => "Illegal instruction",
        ("windows", 0xc0000094) => "Integer division by zero",
        ("windows", 0x40000015) => "Process aborted",
        #[cfg(unix)]
        ("ios" | "linux" | "android", code) if code == libc::SIGABRT as u64 => "Process aborted",
        #[cfg(unix)]
        ("ios" | "linux" | "android", code) if code == libc::SIGSEGV as u64 => {
            "Invalid memory access"
        }
        #[cfg(unix)]
        ("ios" | "linux" | "android", code) if code == libc::SIGBUS as u64 => "Bus error",
        #[cfg(unix)]
        ("ios" | "linux" | "android", code) if code == libc::SIGILL as u64 => "Illegal instruction",
        #[cfg(unix)]
        ("ios" | "linux" | "android", code) if code == libc::SIGFPE as u64 => {
            "Arithmetic exception"
        }
        _ => "Native process crash",
    };
    format!("{reason} (code {code:#x})")
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    app.manage(CrashReports(Mutex::new(ReportStore::new(
        &directory,
        &app.package_info().version.to_string(),
    )?)));
    Ok(())
}

pub fn webview_terminated(app: &AppHandle, label: &str, reason: &str) {
    if let Some(state) = app.try_state::<CrashReports>() {
        if let Ok(store) = state.0.lock() {
            if let Err(error) = store.webview_terminated(label, reason) {
                eprintln!("could not save WebView termination: {error}");
            }
        }
    }
}

#[tauri::command]
pub async fn configure_crash_reporting(
    webview: tauri::Webview,
    state: State<'_, CrashReports>,
    enabled: bool,
    distinct_id: Option<String>,
    session_id: Option<String>,
) -> Result<Vec<CrashReport>, String> {
    let reports = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .configure(enabled, distinct_id, session_id)?;
    #[cfg(target_os = "android")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let mut reports = reports;
            let pids: Vec<u32> = reports
                .iter()
                .filter(|report| report.kind == "native_crash")
                .filter_map(|report| report.pid)
                .collect();
            if !pids.is_empty() {
                match crate::android_exit::read_exits(&webview, pids) {
                    Ok(exits) => attach_exits(&mut reports, &exits),
                    Err(error) => eprintln!("could not read Android exit records: {error}"),
                }
            }
            reports
        })
        .await
        .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = webview;
        Ok(reports)
    }
}

#[tauri::command]
pub fn acknowledge_crash_report(state: State<'_, CrashReports>, id: String) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .acknowledge(&id)
}

#[cfg(all(test, not(target_os = "ios")))]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn native_crash_child() {
        let Ok(directory) = std::env::var("MYELIN_CRASH_TEST_DIR") else {
            return;
        };
        let mut store = ReportStore::new(Path::new(&directory), "1.2.0").unwrap();
        store
            .configure(
                std::env::var("MYELIN_CRASH_TEST_ENABLED").unwrap() == "true",
                Some("crashed-person".into()),
                Some("crashed-session".into()),
            )
            .unwrap();
        let _ = std::thread::Builder::new()
            .name("caught-panic".into())
            .spawn(|| panic!("worker failed"))
            .unwrap()
            .join();
        std::process::abort();
    }

    fn saved_report(pid: Option<u32>, timestamp: &str) -> CrashReport {
        CrashReport {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "native_crash".into(),
            reason: String::new(),
            app_version: "1.0.0".into(),
            platform: "android".into(),
            timestamp: timestamp.into(),
            distinct_id: None,
            session_id: None,
            code: 6,
            detail: "0x0".into(),
            address: "0x0".into(),
            panics: None,
            pid,
            exit: None,
        }
    }

    #[test]
    fn matches_android_exits_by_pid_and_time_and_serializes_their_details() {
        let crashed_at = chrono::DateTime::parse_from_rfc3339("2026-11-03T00:04:54Z")
            .unwrap()
            .timestamp_millis();
        let details = ExitDetails {
            reason: 5,
            rss_kb: 2048,
            tombstone: crate::android_exit::Tombstone {
                abort_message: Some("fdsan: double close".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        let mut reports = [
            saved_report(Some(10), "2026-11-03T00:04:54Z"),
            saved_report(Some(11), "2026-11-03T00:04:54Z"),
            saved_report(None, "2026-11-03T00:04:54Z"),
        ];
        attach_exits(
            &mut reports,
            &[
                (10, crashed_at + 900, details.clone()),
                // The same pid dying again hours later is a different process.
                (11, crashed_at + 7_200_000, details),
            ],
        );
        let sent = serde_json::to_value(&reports[0]).unwrap();
        assert_eq!(sent["exit"]["reason"], 5);
        assert_eq!(sent["exit"]["rssKb"], 2048);
        assert_eq!(sent["exit"]["abortMessage"], "fdsan: double close");
        assert!(reports[1].exit.is_none());
        assert!(reports[2].exit.is_none());
    }

    #[test]
    fn loads_reports_saved_by_older_versions() {
        let report: CrashReport = serde_json::from_str(
            r#"{"id":"a","kind":"native_crash","reason":"","appVersion":"0.3.3",
                "platform":"android","timestamp":"2026-11-03T00:04:54Z","distinctId":null,
                "sessionId":null,"code":6,"detail":"0x0","address":"0x0"}"#,
        )
        .unwrap();
        assert!(report.panics.is_none() && report.pid.is_none());
    }

    #[test]
    fn recovers_actual_native_crashes_and_webview_reports_after_restart() {
        let directory =
            std::env::temp_dir().join(format!("myelin-crash-test-{}", uuid::Uuid::new_v4()));
        for enabled in [false, true] {
            let status = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "crash_reports::tests::native_crash_child",
                    "--nocapture",
                ])
                .env("MYELIN_CRASH_TEST_DIR", &directory)
                .env("MYELIN_CRASH_TEST_ENABLED", enabled.to_string())
                .status()
                .unwrap();
            assert!(!status.success());
            let mut store = ReportStore::new(&directory, "2.0.0").unwrap();
            assert_eq!(store.pending.len(), usize::from(enabled));
            if enabled {
                let report = &store.pending[0];
                assert_eq!(report.app_version, "1.2.0");
                assert_eq!(report.distinct_id.as_deref(), Some("crashed-person"));
                assert_eq!(report.session_id.as_deref(), Some("crashed-session"));
                assert!(report.reason.contains("abort"));
                assert_ne!(report.code, 0);
                let panics = report.panics.as_deref().unwrap();
                assert!(panics.contains("[caught-panic]"));
                assert!(panics.contains("crash_reports.rs"));
                assert!(panics.contains("worker failed"));
                let id = report.id.clone();
                store.acknowledge("../../unrelated").unwrap();
                assert_eq!(store.pending.len(), 1);
                store.acknowledge(&id).unwrap();
                assert!(!store.directory.join(format!("{id}.json")).exists());
                assert!(!store.directory.join(format!("{id}.panics")).exists());
                store
                    .configure(true, Some("new-person".into()), Some("new-session".into()))
                    .unwrap();
                store
                    .webview_terminated("main", "renderer crashed")
                    .unwrap();
                let _ = std::thread::spawn(|| panic!("caught before a clean exit")).join();
            }
        }
        let mut store = ReportStore::new(&directory, "3.0.0").unwrap();
        assert_eq!(store.pending.len(), 1);
        assert!(!fs::read_dir(&store.directory).unwrap().any(|entry| entry
            .unwrap()
            .path()
            .extension()
            .is_some_and(|ext| ext == "panics")));
        assert_eq!(store.pending[0].kind, "webview_termination");
        assert_eq!(store.pending[0].app_version, "2.0.0");
        store.configure(false, None, None).unwrap();
        store
            .webview_terminated("main", "renderer crashed")
            .unwrap();
        assert!(store.pending.is_empty());
        assert_eq!(fs::read_dir(&store.directory).unwrap().count(), 1);
        drop(store);
        fs::remove_dir_all(directory).unwrap();
    }
}
