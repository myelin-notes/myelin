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
}

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
pub fn configure_crash_reporting(
    state: State<'_, CrashReports>,
    enabled: bool,
    distinct_id: Option<String>,
    session_id: Option<String>,
) -> Result<Vec<CrashReport>, String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .configure(enabled, distinct_id, session_id)
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
        std::process::abort();
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
                let id = report.id.clone();
                store.acknowledge("../../unrelated").unwrap();
                assert_eq!(store.pending.len(), 1);
                store.acknowledge(&id).unwrap();
                assert!(!store.directory.join(format!("{id}.json")).exists());
                store
                    .configure(true, Some("new-person".into()), Some("new-session".into()))
                    .unwrap();
                store
                    .webview_terminated("main", "renderer crashed")
                    .unwrap();
            }
        }
        let mut store = ReportStore::new(&directory, "3.0.0").unwrap();
        assert_eq!(store.pending.len(), 1);
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
