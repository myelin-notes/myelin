import type { PdfExportCapability } from '@myelin/editor/platform/types';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { MOBILE_PLATFORM } from '@/lib/env';

export const pdfExport: PdfExportCapability = {
  async export({ suggestedName, buildRequest }) {
    if (MOBILE_PLATFORM === 'ios') {
      const request = await buildRequest();
      if (!request) {
        return { cancelled: true };
      }
      const saved = await invoke<boolean>('export_pdf_ios', {
        request,
        suggestedName,
      });
      return { cancelled: !saved };
    }

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
