import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Logger } from '@/lib/logger';
import type { VFSNodeId } from '@/lib/sync';
import * as cache from './cache';

const logger = new Logger('NoteIndexService');

/**
 * One reindex request, as passed to the Rust engine. The frontend owns the
 * node list (the manifest), so it supplies the on-disk path and file type.
 */
export interface ReindexItem {
  nodeId: VFSNodeId;
  path: string;
  fileType: string;
}

/** node id -> extracted text. The synchronous corpus the search layer reads. */
const contentByNode = new Map<VFSNodeId, string>();
const subscribers = new Set<() => void>();
let unlisten: UnlistenFn | null = null;

function notify(): void {
  for (const callback of subscribers) {
    try {
      callback();
    } catch (err) {
      logger.error('Subscriber threw', err);
    }
  }
}

function yieldToIdle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (
      globalThis as {
        requestIdleCallback?: (
          cb: () => void,
          opts: { timeout: number },
        ) => void;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function refresh(nodeId: VFSNodeId): Promise<void> {
  try {
    const text = await cache.readNodeText(nodeId);
    if (text) {
      contentByNode.set(nodeId, text);
    } else {
      contentByNode.delete(nodeId);
    }
    notify();
  } catch (err) {
    logger.error('Failed to refresh index', err, { nodeId });
  }
}

/**
 * Wire up the engine: listen for completion events and hydrate the in-memory
 * corpus from previously-written artifacts. Call once at app startup.
 */
export async function initNoteIndex(): Promise<void> {
  if (unlisten) {
    return;
  }
  unlisten = await listen<{ nodeId: VFSNodeId }>('index-updated', (event) => {
    void refresh(event.payload.nodeId);
  });

  let ids: VFSNodeId[];
  try {
    ids = await cache.listIndexedNodeIds();
  } catch (err) {
    logger.error('Failed to list indexed nodes', err);
    return;
  }
  for (const id of ids) {
    const text = await cache.readNodeText(id).catch(() => null);
    if (text) {
      contentByNode.set(id, text);
    }
    await yieldToIdle();
  }
  notify();
}

/** The synchronous index corpus, keyed by node id, for the search layer. */
export function getIndexContent(): ReadonlyMap<VFSNodeId, string> {
  return contentByNode;
}

export function subscribeIndex(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/** Queue a single note for (debounced) reindexing in the Rust engine. */
export function requestReindex(
  nodeId: VFSNodeId,
  path: string,
  fileType: string,
): void {
  void invoke('reindex_note', { nodeId, path, fileType }).catch((err) => {
    logger.error('reindex_note failed', err, { nodeId });
  });
}

/** Hand the engine a batch of stale/missing candidates (startup backfill). */
export function startBackfill(items: ReindexItem[]): void {
  if (items.length === 0) {
    return;
  }
  void invoke('reindex_batch', { items }).catch((err) => {
    logger.error('reindex_batch failed', err);
  });
}

export async function removeIndex(nodeId: VFSNodeId): Promise<void> {
  contentByNode.delete(nodeId);
  notify();
  try {
    await invoke('remove_index', { nodeId });
  } catch (err) {
    logger.error('remove_index failed', err, { nodeId });
  }
}
