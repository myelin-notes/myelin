// TEMP diagnostic: logs the NSEvents a Wacom pen produces before WebKit sees them.
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::ptr::NonNull;

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventSubtype, NSEventType};
use tauri::{AppHandle, Manager};

// ~/Library/Logs/<identifier>/tablet-probe.log; release builds have no visible stderr.
fn open_log(app: &AppHandle) -> Option<File> {
    let dir = app.path().app_log_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("tablet-probe.log"))
        .ok()
}

pub fn install(app: &AppHandle) {
    let log = open_log(app);
    if let Some(mut file) = log.as_ref() {
        let _ = writeln!(file, "---- session start ----");
    }
    let mask = NSEventMask::TabletPoint
        | NSEventMask::TabletProximity
        | NSEventMask::LeftMouseDown
        | NSEventMask::LeftMouseUp
        | NSEventMask::LeftMouseDragged
        | NSEventMask::RightMouseDown
        | NSEventMask::RightMouseUp
        | NSEventMask::OtherMouseDown
        | NSEventMask::OtherMouseUp
        | NSEventMask::OtherMouseDragged
        | NSEventMask::MouseMoved;
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        let e = unsafe { event.as_ref() };
        let ty = e.r#type();
        // `subtype` raises NSInternalInconsistencyException on native tablet events, and the
        // exception aborts the app when it unwinds into tao's `extern "C"` sendEvent: override.
        let subtype = (ty != NSEventType::TabletPoint && ty != NSEventType::TabletProximity)
            .then(|| e.subtype());
        let proximity =
            ty == NSEventType::TabletProximity || subtype == Some(NSEventSubtype::TabletProximity);
        let point = ty == NSEventType::TabletPoint || subtype == Some(NSEventSubtype::TabletPoint);
        if ty == NSEventType::MouseMoved && !proximity && !point {
            return event.as_ptr();
        }
        let mut line = format!(
            "[tablet] t={:.3} type={} subtype={:?}",
            e.timestamp(),
            ty.0,
            subtype.map(|s| s.0)
        );
        if proximity {
            line += &format!(
                " PROX entering={} device={} deviceId={} pointerType={} serial={}",
                e.isEnteringProximity(),
                e.pointingDeviceID(),
                e.deviceID(),
                e.pointingDeviceType().0,
                e.pointingDeviceSerialNumber(),
            );
        } else {
            line += &format!(" button={} pressure={:.2}", e.buttonNumber(), e.pressure());
            if point {
                line += &format!(
                    " buttonMask={:#x} deviceId={}",
                    e.buttonMask().0,
                    e.deviceID()
                );
            }
        }
        eprintln!("{line}");
        if let Some(mut file) = log.as_ref() {
            let _ = writeln!(file, "{line}");
        }
        event.as_ptr()
    });
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &handler) };
    std::mem::forget(monitor);
}
