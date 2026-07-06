import type { PdfExportCapability } from '@myelin/editor/platform/types';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

/**
 * Destination picking plus the Rust `export_pdf` command. Fire-and-forget on
 * the Rust side: it renders the display list and writes the file at the picked
 * path itself; nothing comes back.
 */
export const pdfExport: PdfExportCapability = {
  async export({ suggestedName, buildRequest }) {
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!path) {
      return { cancelled: true };
    }
    const request = await buildRequest();
    if (!request) {
      return { cancelled: true };
    }
    await invoke('export_pdf', { request, outPath: path });
    return { cancelled: false };
  },
};
