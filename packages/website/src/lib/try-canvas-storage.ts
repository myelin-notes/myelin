import * as Y from 'yjs';
import {
  base64ToBytes,
  bytesToBase64,
} from '@myelin/editor/clipboard/snapshot';

const STORAGE_KEY = 'myelin:try-canvas';
const SAVE_DELAY_MS = 300;

function merge(doc: Y.Doc, saved: string | null): void {
  if (!saved) {
    return;
  }
  try {
    Y.applyUpdate(doc, base64ToBytes(saved));
  } catch (error) {
    console.warn('Ignoring an unreadable saved try-it canvas', error);
  }
}

/**
 * Restores the saved try-it canvas into `doc`, then saves it after edits.
 * Saves from other tabs are merged in, so two open tabs never overwrite each
 * other. Call before building the canvas on `doc`; the returned stop function
 * flushes a pending save.
 */
export function persistTryCanvas(doc: Y.Doc): () => void {
  try {
    merge(doc, localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    console.warn('Could not read the saved try-it canvas', error);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        bytesToBase64(Y.encodeStateAsUpdate(doc)),
      );
    } catch (error) {
      // Over quota or storage blocked: the canvas keeps working, unsaved.
      console.warn('Could not save the try-it canvas', error);
    }
  };
  // Throttled, not debounced, so continuous typing still saves.
  const scheduleSave = () => {
    timer ??= setTimeout(save, SAVE_DELAY_MS);
  };
  const flush = () => {
    if (timer !== undefined) {
      save();
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      merge(doc, event.newValue);
    }
  };

  doc.on('update', scheduleSave);
  window.addEventListener('pagehide', flush);
  window.addEventListener('storage', handleStorage);
  return () => {
    doc.off('update', scheduleSave);
    window.removeEventListener('pagehide', flush);
    window.removeEventListener('storage', handleStorage);
    flush();
  };
}
