use std::ptr::NonNull;

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask, NSPointingDeviceType};
use tauri::{AppHandle, Emitter};

// Wacom reports the eraser (tail end, or a side button mapped to "Eraser") only through tablet
// proximity events, which WKWebView drops; the contacts that follow are plain left-mouse events.
// shortcut: a local monitor misses proximity changes made while another app is frontmost.
pub fn install(app: &AppHandle) {
    let app = app.clone();
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        let e = unsafe { event.as_ref() };
        let eraser =
            e.isEnteringProximity() && e.pointingDeviceType() == NSPointingDeviceType::Eraser;
        let _ = app.emit("tablet-eraser", eraser);
        event.as_ptr()
    });
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(
            NSEventMask::TabletProximity,
            &handler,
        )
    };
    // The monitor lives for the app's lifetime.
    std::mem::forget(monitor);
}
