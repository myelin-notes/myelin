use std::fs;

#[tauri::command]
fn create_dir_all(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("{}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![create_dir_all])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
