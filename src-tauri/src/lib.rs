use std::fs;

mod github_credentials;
mod github_repo;
mod peer;

#[tauri::command]
fn create_dir_all(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("{}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_ocr::init())
        .manage(peer::PeerState::new())
        .invoke_handler(tauri::generate_handler![
            create_dir_all,
            github_credentials::github_clear_token,
            github_credentials::github_has_token,
            github_credentials::github_secure_storage_available,
            github_credentials::github_store_token,
            github_repo::github_delete_contents,
            github_repo::github_get_contents,
            github_repo::github_put_contents,
            peer::peer_host,
            peer::peer_join,
            peer::peer_send,
            peer::peer_disconnect,
            peer::get_local_ip,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
