const COMMANDS: &[&str] = &["recognize"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
