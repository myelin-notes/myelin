const COMMANDS: &[&str] = &[
    "get_tracking_authorization_status",
    "request_tracking_authorization",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
