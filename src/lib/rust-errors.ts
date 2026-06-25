import { listen } from '@tauri-apps/api/event';
import { Logger } from '@/lib/logger';

/** Mirrors the Rust `error_report::RUST_ERROR_EVENT` payload. */
interface RustErrorPayload {
  subsystem: string;
  message: string;
  detail: string;
}

/**
 * Single sink for failures the Rust backend hits off the IPC request path
 * (spawned workers, event emitters) where there's no invoke to reject. Rust
 * emits a `rust-error` event; we forward it to the logger as an error so it
 * lands in both the log file and PostHog, the same place IPC-path failures
 * already go. Lives for the app's lifetime, so the unlisten handle is ignored.
 */
export function initRustErrorReporting(): void {
  void listen<RustErrorPayload>('rust-error', (event) => {
    const { subsystem, message, detail } = event.payload;
    new Logger(subsystem).error(message, new Error(detail));
  });
}
