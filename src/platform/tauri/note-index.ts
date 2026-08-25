import type {
  NoteEmbedding,
  NoteIndexCapability,
  ReindexItem,
} from '@myelin/editor/platform/types';
import type { VFSNodeId } from '@myelin/editor/sync/types';
import { Logger } from '@myelin/shared/logger';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as cache from './note-index-cache';

const logger = new Logger('NoteIndexService');

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
 * Thin client over the Rust note-index engine. The heavy work — provider selection, extraction,
 * queueing, staleness — all lives in Rust.
 */
export class TauriNoteIndexService implements NoteIndexCapability {
  /** node id -> extracted text. The synchronous corpus the search layer reads. */
  private readonly contentByNode = new Map<VFSNodeId, string>();
  private readonly embeddingByNode = new Map<VFSNodeId, NoteEmbedding>();
  /** Bumped whenever {@link contentByNode} changes; see {@link contentRevision}. */
  private _contentRevision = 0;
  private unlisten: UnlistenFn | null = null;
  // Index artifacts are namespaced per repo on disk, and reindex/remove target this repo. Null
  // between a {@link reset} and the next {@link init}.
  private repoId: string | null = null;

  // Call on startup and after every repository switch, paired with {@link reset} on teardown.
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

  // The completion listener stays registered (it is engine-wide, not per-repo); events for a
  // non-current repo are ignored until the next {@link init}.
  reset(): void {
    this.repoId = null;
    this.contentByNode.clear();
    this.embeddingByNode.clear();
    this._contentRevision++;
  }

  getContent(): ReadonlyMap<VFSNodeId, string> {
    return this.contentByNode;
  }

  contentRevision(): number {
    return this._contentRevision;
  }

  getEmbeddings(): ReadonlyMap<VFSNodeId, NoteEmbedding> {
    return this.embeddingByNode;
  }

  async embedSearchQuery(query: string): Promise<NoteEmbedding> {
    return invoke<NoteEmbedding>('embed_search_query', { query });
  }

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
    this._contentRevision++;
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
    this._contentRevision++;

    // Keep any well-formed embedding regardless of model id; search correctness is enforced
    // downstream by matching the query embedding's model against each passage's. Hardcoding a model
    // id here previously silently dropped the whole corpus after a model swap.
    const embedding = record?.embedding;
    if (
      embedding &&
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
