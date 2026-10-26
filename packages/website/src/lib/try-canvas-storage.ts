import * as Y from 'yjs';
import type { CanvasViewport } from '@myelin/editor/canvas-viewport';
import {
  base64ToBytes,
  bytesToBase64,
} from '@myelin/editor/clipboard/snapshot';

const STORAGE_KEY = 'myelin:try-canvas';
const VIEW_STORAGE_KEY = 'myelin:try-canvas-view';
const SAVE_DELAY_MS = 300;

// Throttled, not debounced, so continuous edits still save.
function throttledSave(key: string, serialize: () => string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    try {
      localStorage.setItem(key, serialize());
    } catch (error) {
      // Over quota or storage blocked: the canvas keeps working, unsaved.
      console.warn('Could not save the try-it canvas', error);
    }
  };
  return {
    schedule: () => {
      timer ??= setTimeout(save, SAVE_DELAY_MS);
    },
    flush: () => {
      if (timer !== undefined) {
        save();
      }
    },
  };
}

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

  const { schedule: scheduleSave, flush } = throttledSave(STORAGE_KEY, () =>
    bytesToBase64(Y.encodeStateAsUpdate(doc)),
  );
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

/** Restores the saved camera, then saves it as it moves, as the app does per note. */
export function persistTryCanvasView(viewport: CanvasViewport): () => void {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY) ?? 'null');
    // setView doesn't validate; a garbled save would leave the canvas blank.
    if (
      Number.isFinite(saved?.zoom) &&
      Number.isFinite(saved?.offset?.x) &&
      Number.isFinite(saved?.offset?.y)
    ) {
      viewport.setView(saved);
    }
  } catch (error) {
    console.warn('Could not read the saved try-it view', error);
  }

  const { schedule, flush } = throttledSave(VIEW_STORAGE_KEY, () =>
    JSON.stringify({ zoom: viewport.zoom, offset: viewport.offset }),
  );
  const unsubscribe = viewport.onViewChange(schedule);
  return () => {
    unsubscribe();
    flush();
  };
}
