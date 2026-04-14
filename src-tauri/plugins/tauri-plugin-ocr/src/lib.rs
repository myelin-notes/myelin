use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use tauri::{
    command,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "macos")]
extern "C" {
    fn recognize_text_from_path(path: *const c_char) -> *mut c_char;
    fn free_ocr_string(ptr: *mut c_char);
}

#[cfg(target_os = "macos")]
fn ocr_from_path(path: &str) -> Result<String, String> {
    let c_path = CString::new(path).map_err(|e| e.to_string())?;
    unsafe {
        let result_ptr = recognize_text_from_path(c_path.as_ptr());
        if result_ptr.is_null() {
            return Err("OCR returned null".into());
        }
        let result = CStr::from_ptr(result_ptr).to_string_lossy().into_owned();
        free_ocr_string(result_ptr);
        Ok(result)
    }
}

#[command]
fn recognize_text(path: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    return ocr_from_path(&path);

    #[cfg(not(target_os = "macos"))]
    return Err("OCR is only available on macOS".into());
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ocr")
        .invoke_handler(tauri::generate_handler![recognize_text])
        .build()
}
