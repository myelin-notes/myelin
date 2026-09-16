const COMMANDS: &[&str] = &["authenticate_web", "cancel_web_authentication"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
