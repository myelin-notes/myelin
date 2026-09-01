// The built-in mobile plugin event commands used by `addPluginListener` on the
// JS side; there are no custom commands. The ACL sees the snake_case names JS
// invokes (tauri camel-cases them only when forwarding to the Swift plugin),
// but older @tauri-apps/api fell back to camelCase, so both are allowed.
const COMMANDS: &[&str] = &[
    "register_listener",
    "remove_listener",
    "registerListener",
    "removeListener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
