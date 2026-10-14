use tauri::AppHandle;
#[cfg(any(target_os = "linux", target_os = "windows"))]
use tauri::Manager;

pub fn setup(app: &AppHandle) {
    #[cfg(target_os = "android")]
    {
        let _ = ANDROID_APP.set(app.clone());
    }
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    if let Some(window) = app.get_webview_window("main") {
        let handle = app.clone();
        if let Err(error) = window.with_webview(move |webview| {
            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::WebViewExt;
                webview
                    .inner()
                    .connect_web_process_terminated(move |_, reason| {
                        crate::crash_reports::webview_terminated(
                            &handle,
                            "main",
                            &format!("{reason:?}"),
                        );
                    });
            }
            #[cfg(target_os = "windows")]
            unsafe {
                use webview2_com::{Microsoft::Web::WebView2::Win32::*, ProcessFailedEventHandler};
                let result = (|| {
                    let core = webview.controller().CoreWebView2()?;
                    let callback = ProcessFailedEventHandler::create(Box::new(move |_, args| {
                        if let Some(args) = args {
                            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND(0);
                            args.ProcessFailedKind(&mut kind)?;
                            let reason = match kind {
                                COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => {
                                    "browser process exited"
                                }
                                COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => {
                                    "renderer process exited"
                                }
                                COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED => {
                                    "frame renderer process exited"
                                }
                                _ => return Ok(()),
                            };
                            crate::crash_reports::webview_terminated(&handle, "main", reason);
                        }
                        Ok(())
                    }));
                    let mut token = 0;
                    core.add_ProcessFailed(&callback, &mut token)
                })();
                if let Err(error) = result {
                    eprintln!("could not install WebView2 crash handler: {error}");
                }
            }
        }) {
            eprintln!("could not install WebView crash handler: {error}");
        }
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let _ = app;
}

#[cfg(target_os = "android")]
static ANDROID_APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_github_wintersteve25_myelin_RustWebViewClient_reportRendererTermination(
    _env: jni::JNIEnv<'_>,
    _client: jni::objects::JObject<'_>,
    did_crash: jni::sys::jboolean,
) {
    if let Some(app) = ANDROID_APP.get() {
        let reason = if did_crash != 0 {
            "renderer crashed"
        } else {
            "renderer killed by the system"
        };
        crate::crash_reports::webview_terminated(app, "main", reason);
    }
}
