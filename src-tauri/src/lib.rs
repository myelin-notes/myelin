use tauri::Manager;

mod code_runner;
mod error_report;
mod handwriting;
mod iroh_transport;
mod mcp_server;
mod note_index;
mod pdf_export;
mod transcription;
mod workspace_export;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }

            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app local data path")
                .join("stronghold-salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            // WebKitGTK denies getUserMedia by default; enable media streams
            // and allow microphone permission requests so audio recording works.
            #[cfg(target_os = "linux")]
            app.get_webview_window("main")
                .expect("main window missing")
                .with_webview(|webview| {
                    use webkit2gtk::{
                        glib::prelude::*, PermissionRequestExt, SettingsExt,
                        UserMediaPermissionRequest, UserMediaPermissionRequestExt, WebViewExt,
                    };
                    let webview = webview.inner();
                    if let Some(settings) = webview.settings() {
                        settings.set_enable_media_stream(true);
                        settings.set_enable_webrtc(true);
                    }
                    webview.connect_permission_request(|_, request| {
                        if let Some(request) = request.downcast_ref::<UserMediaPermissionRequest>()
                        {
                            if request.is_for_audio_device() && !request.is_for_video_device() {
                                request.allow();
                            } else {
                                request.deny();
                            }
                            true
                        } else {
                            false
                        }
                    });
                })?;

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_ocr::init())
        .manage(iroh_transport::IrohState::new())
        .manage(mcp_server::McpServerState::new())
        .manage(note_index::IndexEngineState::new())
        .manage(handwriting::HandwritingState::new())
        .manage(transcription::TranscriptionState::new())
        .manage(code_runner::CodeRunnerState::new())
        .invoke_handler(tauri::generate_handler![
            iroh_transport::iroh_host,
            iroh_transport::iroh_join,
            iroh_transport::iroh_send,
            iroh_transport::iroh_leave,
            pdf_export::export_pdf,
            workspace_export::export_obsidian_vault,
            mcp_server::mcp_start,
            mcp_server::mcp_stop,
            mcp_server::mcp_status,
            mcp_server::mcp_respond,
            note_index::reindex_note,
            note_index::reindex_batch,
            note_index::remove_index,
            note_index::embed_search_query,
            handwriting::recognize_handwriting,
            handwriting::recognize_handwriting_batch,
            handwriting::remove_handwriting,
            transcription::start_audio_transcription,
            transcription::push_audio_transcription_samples,
            transcription::finish_audio_transcription,
            transcription::cancel_audio_transcription,
            code_runner::run_code,
            code_runner::cancel_run,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
