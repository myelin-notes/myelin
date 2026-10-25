import type { Platform } from '@myelin/editor/platform/types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MOBILE_PLATFORM } from '@/lib/env';
import { artifactCache } from './artifact-cache';
import { codeRunner } from './code-runner';
import { IrohTransport } from './iroh';
import { pdfExport } from './pdf-export';
import { transcription } from './transcription';

export const tauriPlatform: Platform = {
  async saveFile({ suggestedName, filter, data }) {
    if (MOBILE_PLATFORM === 'ios') {
      const resolved = await data;
      const bytes =
        typeof resolved === 'string'
          ? new TextEncoder().encode(resolved)
          : resolved;
      const saved = await invoke<boolean>('export_file_ios', {
        suggestedName,
        bytes: Array.from(bytes),
      });
      return { cancelled: !saved };
    }
    const path = await save({
      defaultPath: suggestedName,
      filters: filter ? [filter] : undefined,
    });
    if (!path) {
      return { cancelled: true };
    }
    const resolved = await data;
    if (typeof resolved === 'string') {
      await writeTextFile(path, resolved);
    } else {
      await writeFile(path, resolved);
    }
    return { cancelled: false };
  },

  openExternal(url) {
    return openUrl(url);
  },

  fetch(input, init) {
    return tauriFetch(input, init);
  },

  artifactCache,

  subscribeEvent<T>(event: string, handler: (payload: T) => void) {
    return listen<T>(event, (e) => handler(e.payload));
  },

  transcription,
  codeRunner,
  pdfExport,
  createLiveTransport: (noteId) => new IrohTransport(noteId),
};
