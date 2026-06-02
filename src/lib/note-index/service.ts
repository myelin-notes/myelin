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

/**
 * Thin client over the Rust note-index engine: triggers reindexing, listens for
 * completion events, and holds the in-memory search corpus the search layer
 * reads. The heavy work (provider selection, extraction, queueing, staleness)
 * all lives in Rust. A single {@link noteIndexService} instance is shared app-wide.
 */
export class NoteIndexService {
  /** node id -> extracted text. The synchronous corpus the search layer reads. */
  private readonly contentByNode = new Map<VFSNodeId, string>();
  private readonly subscribers = new Set<() => void>();
  private unlisten: UnlistenFn | null = null;

  /**
   * Wire up the engine: listen for completion events and hydrate the in-memory
   * corpus from previously-written artifacts. Idempotent; call once at startup.
   */
  async init(): Promise<void> {
    if (this.unlisten) {
      return;
    }
    this.unlisten = await listen<{ nodeId: VFSNodeId }>(
      'index-updated',
      (event) => {
        void this.refresh(event.payload.nodeId);
      },
    );

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
        this.contentByNode.set(id, text);
      }
      await yieldToIdle();
    }
    this.notify();
  }

  /** The synchronous index corpus, keyed by node id, for the search layer. */
  getContent(): ReadonlyMap<VFSNodeId, string> {
    return this.contentByNode;
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /** Queue a single note for (debounced) reindexing in the Rust engine. */
  requestReindex(nodeId: VFSNodeId, path: string, fileType: string): void {
    void invoke('reindex_note', { nodeId, path, fileType }).catch((err) => {
      logger.error('reindex_note failed', err, { nodeId });
    });
  }

  /** Hand the engine a batch of stale/missing candidates (startup backfill). */
  startBackfill(items: ReindexItem[]): void {
    if (items.length === 0) {
      return;
    }
    void invoke('reindex_batch', { items }).catch((err) => {
      logger.error('reindex_batch failed', err);
    });
  }

  async removeIndex(nodeId: VFSNodeId): Promise<void> {
    this.contentByNode.delete(nodeId);
    this.notify();
    try {
      await invoke('remove_index', { nodeId });
    } catch (err) {
      logger.error('remove_index failed', err, { nodeId });
    }
  }

  private notify(): void {
    for (const callback of this.subscribers) {
      try {
        callback();
      } catch (err) {
        logger.error('Subscriber threw', err);
      }
    }
  }

  private async refresh(nodeId: VFSNodeId): Promise<void> {
    try {
      const text = await cache.readNodeText(nodeId);
      if (text) {
        this.contentByNode.set(nodeId, text);
      } else {
        this.contentByNode.delete(nodeId);
      }
      this.notify();
    } catch (err) {
      logger.error('Failed to refresh index', err, { nodeId });
    }
  }
}

export const noteIndexService = new NoteIndexService();
