const COMMANDS: &[&str] = &[
    "authenticate_web",
    "cancel_web_authentication",
    "purchase_pro",
    "pro_entitlement",
    "storefront",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
