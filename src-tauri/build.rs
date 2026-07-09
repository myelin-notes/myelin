fn main() {
    // When the Vulkan GPU backend is compiled in (gpu-vulkan feature), delay-load
    // vulkan-1.dll so the app still launches on Windows machines that lack a Vulkan
    // loader (e.g. no GPU driver). Without this the import is resolved at process
    // start and the app fails to launch. This pairs with scribble's runtime loader
    // probe, which disables GPU when the loader is absent so whisper never triggers
    // the delayed import (a missing delay-loaded DLL faults rather than returning).
    let target_windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    if target_windows && std::env::var("CARGO_FEATURE_GPU_VULKAN").is_ok() {
        println!("cargo:rustc-link-arg-bins=/DELAYLOAD:vulkan-1.dll");
        println!("cargo:rustc-link-arg-bins=delayimp.lib");
    }

    tauri_build::build()
}
