const COMMANDS: &[&str] = &[
    "authenticate_web",
    "cancel_web_authentication",
    "get_tracking_authorization_status",
    "request_tracking_authorization",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
