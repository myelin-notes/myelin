use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("play-billing")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(
                "com.github.wintersteve25.myelin.playbilling",
                "PlayBillingPlugin",
            )?;
            Ok(())
        })
        .build()
}
