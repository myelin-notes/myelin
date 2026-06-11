use tauri::Manager;

mod iroh_transport;
mod mcp_server;
mod note_index;
mod pdf_export;

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
        .manage(mcp_server::McpServerState::new())
        .manage(note_index::IndexEngineState::new())
        .invoke_handler(tauri::generate_handler![
            iroh_transport::iroh_host,
            iroh_transport::iroh_join,
            iroh_transport::iroh_send,
            iroh_transport::iroh_leave,
            pdf_export::export_pdf,
            mcp_server::mcp_start,
            mcp_server::mcp_stop,
            mcp_server::mcp_status,
            mcp_server::mcp_respond,
            note_index::reindex_note,
            note_index::reindex_batch,
            note_index::remove_index,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
