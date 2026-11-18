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

pub const MAX_FRAMES: usize = 64;

/// The journal's crash record: `[time, code, detail, address]`, then optionally
/// `[module start, module end, pc...]` where the module is this library's load range.
pub const RECORD_WORDS: usize = 6 + MAX_FRAMES;

impl CrashWriter {
    // Only stack storage, atomics and OS writes: this runs with potentially corrupted allocator state.
    pub fn record(&self, code: u64, detail: u64, address: u64, trace: Option<&Trace>) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let mut words = [0u64; RECORD_WORDS];
        let timestamp = unsafe { libc::time(std::ptr::null_mut()) } as u64;
        words[..4].copy_from_slice(&[timestamp, code, detail, address]);
        let mut count = 4;
        if let Some(trace) = trace.filter(|trace| trace.count > 0) {
            words[4..6].copy_from_slice(&[trace.module.0, trace.module.1]);
            words[6..6 + trace.count].copy_from_slice(&trace.pcs[..trace.count]);
            count = 6 + trace.count;
        }
        let mut bytes = [0u8; RECORD_WORDS * 8];
        for (slot, value) in bytes.chunks_exact_mut(8).zip(&words[..count]) {
            slot.copy_from_slice(&value.to_le_bytes());
        }
        let bytes = &bytes[..count * 8];
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

pub struct Trace {
    module: (u64, u64),
    pcs: [u64; MAX_FRAMES],
    count: usize,
}

// Android exit-time aborts leave no tombstone (the process exits itself), so the crashing thread's
// stack is only available here. Signal handlers run on that thread on Linux/Android; macOS hands
// the crash to a separate handler thread, so its stack would be the wrong one.
#[cfg(any(target_os = "linux", target_os = "android"))]
mod unwind {
    use super::{Trace, MAX_FRAMES};
    use std::ffi::{c_int, c_void};

    extern "C" {
        fn _Unwind_Backtrace(
            trace: extern "C" fn(*mut c_void, *mut c_void) -> c_int,
            arg: *mut c_void,
        ) -> c_int;
        fn _Unwind_GetIP(context: *mut c_void) -> usize;
    }

    extern "C" fn push(context: *mut c_void, arg: *mut c_void) -> c_int {
        let trace = unsafe { &mut *arg.cast::<Trace>() };
        if trace.count == MAX_FRAMES {
            return 5; // _URC_END_OF_STACK
        }
        trace.pcs[trace.count] = unsafe { _Unwind_GetIP(context) } as u64;
        trace.count += 1;
        0 // _URC_NO_REASON
    }

    // Allocation-free, but the unwinder may take the loader lock to find unwind tables; a crash
    // inside the dynamic loader can hang here instead of exiting.
    pub fn capture(module: (u64, u64)) -> Trace {
        let mut trace = Trace {
            module,
            pcs: [0; MAX_FRAMES],
            count: 0,
        };
        unsafe { _Unwind_Backtrace(push, (&mut trace as *mut Trace).cast()) };
        trace
    }

    /// This library's `[load bias, end)`, so recorded pcs can be made relative for `ndk-stack`.
    pub fn own_module() -> (u64, u64) {
        unsafe extern "C" fn visit(
            info: *mut libc::dl_phdr_info,
            _: libc::size_t,
            data: *mut c_void,
        ) -> c_int {
            let found = unsafe { &mut *data.cast::<(u64, u64)>() };
            let info = unsafe { &*info };
            let target = own_module as *const () as u64;
            let headers =
                unsafe { std::slice::from_raw_parts(info.dlpi_phdr, info.dlpi_phnum as usize) };
            let end = headers
                .iter()
                .filter(|header| header.p_type == libc::PT_LOAD)
                .map(|header| info.dlpi_addr as u64 + header.p_vaddr as u64 + header.p_memsz as u64)
                .max()
                .unwrap_or(0);
            if (info.dlpi_addr as u64..end).contains(&target) {
                *found = (info.dlpi_addr as u64, end);
                return 1;
            }
            0
        }
        let mut found = (0, 0);
        unsafe { libc::dl_iterate_phdr(Some(visit), (&mut found as *mut (u64, u64)).cast()) };
        found
    }
}

#[cfg(not(target_os = "ios"))]
pub fn install(writer: CrashWriter) -> Result<crash_handler::CrashHandler, String> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let module = unwind::own_module();
    // The callback neither allocates nor locks, and the captured File owns its handle for the handler's lifetime.
    let event = unsafe {
        crash_handler::make_crash_event(move |context| {
            #[cfg(target_os = "macos")]
            if let Some(exception) = context.exception {
                writer.record(
                    exception.kind as u64,
                    exception.code,
                    exception.subcode.unwrap_or(0),
                    None,
                );
            }
            #[cfg(any(target_os = "linux", target_os = "android"))]
            writer.record(
                context.siginfo.ssi_signo as u64,
                context.siginfo.ssi_code as u64,
                context.siginfo.ssi_addr,
                Some(&unwind::capture(module)),
            );
            #[cfg(windows)]
            {
                let address = context
                    .exception_pointers
                    .as_ref()
                    .and_then(|pointers| pointers.ExceptionRecord.as_ref())
                    .map_or(0, |record| record.ExceptionAddress as u64);
                writer.record(context.exception_code as u32 as u64, 0, address, None);
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
            writer.record(signal as u64, detail, address, None);
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
