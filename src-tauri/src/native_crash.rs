use std::{
    fs::File,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

pub struct CrashWriter {
    pub file: File,
    pub enabled: Arc<AtomicBool>,
}

impl CrashWriter {
    // Only stack storage, atomics and OS writes: this runs with potentially corrupted allocator state.
    pub fn record(&self, code: u64, detail: u64, address: u64) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let mut bytes = [0u8; 32];
        let timestamp = unsafe { libc::time(std::ptr::null_mut()) } as u64;
        for (slot, value) in bytes
            .chunks_exact_mut(8)
            .zip([timestamp, code, detail, address])
        {
            slot.copy_from_slice(&value.to_le_bytes());
        }
        #[cfg(unix)]
        unsafe {
            use std::os::fd::AsRawFd;
            let mut offset = 0;
            while offset < bytes.len() {
                let written = libc::write(
                    self.file.as_raw_fd(),
                    bytes[offset..].as_ptr().cast(),
                    bytes.len() - offset,
                );
                if written <= 0 {
                    break;
                }
                offset += written as usize;
            }
        }
        #[cfg(windows)]
        unsafe {
            use std::os::windows::io::AsRawHandle;
            let mut written = 0;
            windows_sys::Win32::Storage::FileSystem::WriteFile(
                self.file.as_raw_handle(),
                bytes.as_ptr(),
                bytes.len() as u32,
                &mut written,
                std::ptr::null_mut(),
            );
        }
    }
}

#[cfg(not(target_os = "ios"))]
pub fn install(writer: CrashWriter) -> Result<crash_handler::CrashHandler, String> {
    // The callback neither allocates nor locks, and the captured File owns its handle for the handler's lifetime.
    let event = unsafe {
        crash_handler::make_crash_event(move |context| {
            #[cfg(target_os = "macos")]
            if let Some(exception) = context.exception {
                writer.record(
                    exception.kind as u64,
                    exception.code,
                    exception.subcode.unwrap_or(0),
                );
            }
            #[cfg(any(target_os = "linux", target_os = "android"))]
            writer.record(
                context.siginfo.ssi_signo as u64,
                context.siginfo.ssi_code as u64,
                context.siginfo.ssi_addr,
            );
            #[cfg(windows)]
            {
                let address = context
                    .exception_pointers
                    .as_ref()
                    .and_then(|pointers| pointers.ExceptionRecord.as_ref())
                    .map_or(0, |record| record.ExceptionAddress as u64);
                writer.record(context.exception_code as u32 as u64, 0, address);
            }
            // Preserve the OS crash handling and process termination.
            false.into()
        })
    };
    crash_handler::CrashHandler::attach(event).map_err(|error| error.to_string())
}

#[cfg(target_os = "ios")]
mod ios {
    use super::*;
    use std::sync::OnceLock;

    const SIGNALS: [i32; 6] = [
        libc::SIGABRT,
        libc::SIGBUS,
        libc::SIGFPE,
        libc::SIGILL,
        libc::SIGSEGV,
        libc::SIGTRAP,
    ];
    static WRITER: OnceLock<CrashWriter> = OnceLock::new();
    static PREVIOUS: OnceLock<[libc::sigaction; 6]> = OnceLock::new();

    unsafe extern "C" fn on_signal(signal: i32, info: *mut libc::siginfo_t, _: *mut libc::c_void) {
        if let Some(writer) = WRITER.get() {
            let (detail, address) = if info.is_null() {
                (0, 0)
            } else {
                unsafe { ((*info).si_code as u64, (*info).si_addr() as u64) }
            };
            writer.record(signal as u64, detail, address);
        }
        if let Some(index) = SIGNALS.iter().position(|value| *value == signal) {
            if let Some(previous) = PREVIOUS.get() {
                unsafe {
                    libc::sigaction(signal, &previous[index], std::ptr::null_mut());
                    libc::raise(signal);
                }
            }
        }
    }

    pub fn install(writer: CrashWriter) -> Result<(), String> {
        // crash-handler has no iOS backend. Pre-opened writes keep these POSIX signal handlers allocation-free.
        unsafe {
            let mut previous: [libc::sigaction; 6] = std::mem::zeroed();
            for (index, signal) in SIGNALS.iter().enumerate() {
                if libc::sigaction(*signal, std::ptr::null(), &mut previous[index]) != 0 {
                    return Err(std::io::Error::last_os_error().to_string());
                }
            }
            WRITER
                .set(writer)
                .map_err(|_| "crash handler already installed".to_string())?;
            PREVIOUS
                .set(previous)
                .map_err(|_| "crash handler already installed".to_string())?;
            let mut action: libc::sigaction = std::mem::zeroed();
            libc::sigemptyset(&mut action.sa_mask);
            action.sa_flags = libc::SA_SIGINFO | libc::SA_ONSTACK;
            action.sa_sigaction = on_signal as *const () as usize;
            for (index, signal) in SIGNALS.iter().enumerate() {
                if libc::sigaction(*signal, &action, std::ptr::null_mut()) != 0 {
                    for (restore_index, restore_signal) in SIGNALS[..index].iter().enumerate() {
                        libc::sigaction(
                            *restore_signal,
                            &previous[restore_index],
                            std::ptr::null_mut(),
                        );
                    }
                    return Err(std::io::Error::last_os_error().to_string());
                }
            }
        }
        Ok(())
    }
}

#[cfg(target_os = "ios")]
pub use ios::install;
