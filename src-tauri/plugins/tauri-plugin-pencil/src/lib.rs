//! Apple Pencil hardware gestures (double-tap, squeeze) as a Tauri plugin.
//!
//! The Swift half attaches a `UIPencilInteraction` to the webview and triggers
//! `gesture` events carrying the user's system-configured preferred action;
//! WKWebView never surfaces these gestures to JS on its own. On every platform
//! but iOS the plugin registers nothing and no events fire.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_pencil);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("pencil")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_pencil)?;
            Ok(())
        })
        .build()
}
