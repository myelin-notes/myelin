use std::fs;
use tauri::Manager;

mod iroh_transport;
mod rendezvous;

#[tauri::command]
fn create_dir_all(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("{}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .setup(|app| {
            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app local data path")
                .join("stronghold-salt.txt");
            app.handle().plugin(
                tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build(),
            )?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_ocr::init())
        .manage(iroh_transport::IrohState::new())
        .invoke_handler(tauri::generate_handler![
            create_dir_all,
            iroh_transport::iroh_host,
            iroh_transport::iroh_join,
            iroh_transport::iroh_auto_sync,
            iroh_transport::iroh_send,
            iroh_transport::iroh_leave,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
