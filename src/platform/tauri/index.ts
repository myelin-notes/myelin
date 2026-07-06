import type { Platform } from '@myelin/editor/platform/types';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { artifactCache } from './artifact-cache';
import { codeRunner } from './code-runner';
import { TauriHandwritingService } from './handwriting';
import { IrohTransport } from './iroh';
import { writeLogs } from './log-sink';
import { TauriNoteIndexService } from './note-index';
import { pdfExport } from './pdf-export';
import { transcription } from './transcription';

export const tauriPlatform: Platform = {
  async saveFile({ suggestedName, filter, data }) {
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

  writeLogs(lines) {
    return writeLogs(lines);
  },

  subscribeEvent<T>(event: string, handler: (payload: T) => void) {
    return listen<T>(event, (e) => handler(e.payload));
  },

  transcription,
  handwriting: new TauriHandwritingService(),
  codeRunner,
  pdfExport,
  noteIndex: new TauriNoteIndexService(),
  createLiveTransport: (noteId) => new IrohTransport(noteId),
};
