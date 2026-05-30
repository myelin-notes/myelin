/**
 * Thin wrapper over the Rust `export_pdf` command. Fire-and-forget: Rust renders the
 * display list and writes the file at `outPath` itself; nothing comes back.
 *
 * Binaries (original PDF, image blobs) are base64-encoded into the request rather
 * than sent as JSON number arrays (the slow IPC path).
 */

import { invoke } from '@tauri-apps/api/core';
import type { PdfExportRequest } from './contract';

export async function exportPdf(
  request: PdfExportRequest,
  outPath: string,
): Promise<void> {
  await invoke('export_pdf', { request, outPath });
}

/** Base64-encode bytes in chunks (avoids stack overflow on large buffers). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
