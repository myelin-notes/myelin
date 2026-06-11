use tauri::Manager;

mod iroh_transport;
mod note_index;
mod pdf_export;
mod transcription;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .setup(|app| {
            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app local data path")
                .join("stronghold-salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(iroh_transport::IrohState::new())
        .manage(note_index::IndexEngineState::new())
        .manage(transcription::TranscriptionState::new())
        .invoke_handler(tauri::generate_handler![
            iroh_transport::iroh_host,
            iroh_transport::iroh_join,
            iroh_transport::iroh_send,
            iroh_transport::iroh_leave,
            pdf_export::export_pdf,
            note_index::reindex_note,
            note_index::reindex_batch,
            note_index::remove_index,
            transcription::start_audio_transcription,
            transcription::push_audio_transcription_samples,
            transcription::finish_audio_transcription,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
