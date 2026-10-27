import * as Y from 'yjs';
import type { CanvasViewport } from '@myelin/editor/canvas-viewport';

const DB_NAME = 'myelin-try';
const UPDATES_STORE = 'updates';
const VIEW_STORAGE_KEY = 'myelin:try-canvas-view';
const SAVE_DELAY_MS = 300;
// Updates that are already saved: loaded from storage, or sent by the tab that saved them.
const SAVED_ORIGIN = Symbol('try-canvas-saved');

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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(UPDATES_STORE, { autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function settle(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// One transaction, so an update another tab appends meanwhile is either merged here or kept after.
async function loadAndCompact(db: IDBDatabase): Promise<Uint8Array | null> {
  const transaction = db.transaction(UPDATES_STORE, 'readwrite');
  const store = transaction.objectStore(UPDATES_STORE);
  const request = store.getAll();
  let merged: Uint8Array | null = null;
  request.onsuccess = () => {
    const updates = request.result as Uint8Array[];
    if (updates.length > 0) {
      merged = Y.mergeUpdates(updates);
      store.clear();
      store.add(merged);
    }
  };
  await settle(transaction);
  return merged;
}

function append(db: IDBDatabase, update: Uint8Array): Promise<void> {
  const transaction = db.transaction(UPDATES_STORE, 'readwrite');
  transaction.objectStore(UPDATES_STORE).add(update);
  return settle(transaction);
}

/**
 * Loads the saved try-it canvas into `doc` once IndexedDB answers, and saves
 * every edit as its own record, so tabs never overwrite each other. Edits from
 * other open tabs are applied live.
 */
export function persistTryCanvas(doc: Y.Doc): () => void {
  const database = openDatabase();
  database.then(loadAndCompact).then(
    (saved) => {
      if (saved) {
        Y.applyUpdate(doc, saved, SAVED_ORIGIN);
      }
    },
    (error) => console.warn('Could not restore the try-it canvas', error),
  );

  const channel = new BroadcastChannel(DB_NAME);
  channel.onmessage = (event: MessageEvent<Uint8Array>) => {
    Y.applyUpdate(doc, event.data, SAVED_ORIGIN);
  };
  const handleUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === SAVED_ORIGIN) {
      return;
    }
    channel.postMessage(update);
    database
      .then((db) => append(db, update))
      .catch((error) =>
        console.warn('Could not save the try-it canvas', error),
      );
  };

  doc.on('update', handleUpdate);
  return () => {
    doc.off('update', handleUpdate);
    channel.close();
    // close() lets the appends queued above commit first.
    database.then(
      (db) => db.close(),
      () => {},
    );
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
