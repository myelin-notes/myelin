import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Logger } from '@/lib/logger';
import type { VFSNodeId } from '@/lib/sync';
import * as cache from './cache';

const logger = new Logger('NoteIndexService');
const CURRENT_NOTE_EMBEDDING_MODEL = 'Qdrant/all-MiniLM-L6-v2-onnx';

/**
 * One reindex request, as passed to the Rust engine. The frontend owns the
 * node list (the manifest), so it supplies the on-disk path and file type.
 */
export interface ReindexItem {
  nodeId: VFSNodeId;
  path: string;
  fileType: string;
}

export interface NoteEmbedding {
  model: string;
  dim: number;
  vector: number[];
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
  private readonly embeddingByNode = new Map<VFSNodeId, NoteEmbedding>();
  private unlisten: UnlistenFn | null = null;
  /**
   * The repository the corpus currently reflects. Index artifacts are namespaced
   * per repo on disk, and reindex/remove target this repo. Null between a
   * {@link reset} and the next {@link init} (e.g. mid repository switch).
   */
  private repoId: string | null = null;

  /**
   * Point the service at a repository: register the completion listener (once)
   * and hydrate the in-memory corpus from that repo's previously-written
   * artifacts. Call on startup and after every repository switch (paired with
   * {@link reset} on teardown).
   */
  async init(repoId: string): Promise<void> {
    this.repoId = repoId;
    if (!this.unlisten) {
      this.unlisten = await listen<{ nodeId: VFSNodeId; repoId: string }>(
        'index-updated',
        (event) => {
          void this.refresh(event.payload.nodeId, event.payload.repoId);
        },
      );
    }
    await this.hydrate(repoId);
  }

  /**
   * Drop the corpus and detach from the active repository. The completion
   * listener stays registered (it is engine-wide, not per-repo); events for a
   * non-current repo are ignored until the next {@link init}.
   */
  reset(): void {
    this.repoId = null;
    this.contentByNode.clear();
    this.embeddingByNode.clear();
  }

  /** The synchronous index corpus, keyed by node id, for the search layer. */
  getContent(): ReadonlyMap<VFSNodeId, string> {
    return this.contentByNode;
  }

  getEmbeddings(): ReadonlyMap<VFSNodeId, NoteEmbedding> {
    return this.embeddingByNode;
  }

  async embedSearchQuery(query: string): Promise<NoteEmbedding> {
    return invoke<NoteEmbedding>('embed_search_query', { query });
  }

  /** Queue a single note for (debounced) reindexing in the Rust engine. */
  requestReindex(nodeId: VFSNodeId, path: string, fileType: string): void {
    const repoId = this.repoId;
    if (!repoId) {
      return;
    }
    void invoke('reindex_note', { repoId, nodeId, path, fileType }).catch(
      (err) => {
        logger.error('reindex_note failed', err, { nodeId });
      },
    );
  }

  /** Hand the engine a batch of stale/missing candidates (startup backfill). */
  startBackfill(items: ReindexItem[]): void {
    const repoId = this.repoId;
    if (!repoId || items.length === 0) {
      return;
    }
    void invoke('reindex_batch', { repoId, items }).catch((err) => {
      logger.error('reindex_batch failed', err);
    });
  }

  async removeIndex(nodeId: VFSNodeId): Promise<void> {
    const repoId = this.repoId;
    if (!repoId) {
      return;
    }
    this.contentByNode.delete(nodeId);
    this.embeddingByNode.delete(nodeId);
    try {
      await invoke('remove_index', { repoId, nodeId });
    } catch (err) {
      logger.error('remove_index failed', err, { nodeId });
    }
  }

  private async hydrate(repoId: string): Promise<void> {
    let ids: VFSNodeId[];
    try {
      ids = await cache.listIndexedNodeIds(repoId);
    } catch (err) {
      logger.error('Failed to list indexed nodes', err);
      return;
    }
    for (const id of ids) {
      // A repository switch during hydration supersedes this pass.
      if (this.repoId !== repoId) {
        return;
      }
      const record = await cache.readNodeRecord(repoId, id).catch(() => null);
      this.setRecord(id, record);
      await yieldToIdle();
    }
  }

  private async refresh(nodeId: VFSNodeId, repoId: string): Promise<void> {
    // Ignore completions for a repo we have since switched away from.
    if (repoId !== this.repoId) {
      return;
    }
    try {
      const record = await cache.readNodeRecord(repoId, nodeId);
      this.setRecord(nodeId, record);
    } catch (err) {
      logger.error('Failed to refresh index', err, { nodeId });
    }
  }

  private setRecord(
    nodeId: VFSNodeId,
    record: cache.NoteIndexRecord | null,
  ): void {
    if (record?.text) {
      this.contentByNode.set(nodeId, record.text);
    } else {
      this.contentByNode.delete(nodeId);
    }

    const embedding = record?.embedding;
    if (
      embedding &&
      embedding.model === CURRENT_NOTE_EMBEDDING_MODEL &&
      embedding.vector.length === embedding.dim &&
      embedding.dim > 0
    ) {
      this.embeddingByNode.set(nodeId, {
        model: embedding.model,
        dim: embedding.dim,
        vector: embedding.vector,
      });
    } else {
      this.embeddingByNode.delete(nodeId);
    }
  }
}

export const noteIndexService = new NoteIndexService();
