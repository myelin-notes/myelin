const COMMANDS: &[&str] = &["purchase_pro", "pro_entitlement"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
