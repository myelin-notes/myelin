import { invoke } from '@tauri-apps/api/core';
import { Logger } from '@/lib/logger';
import type { ReindexItem } from '@/lib/note-index';
import type { VFSNodeId } from '@/lib/sync';
import { type RecognizedPage, readRecognizedPage } from './cache';

const logger = new Logger('HandwritingService');

/**
 * Thin client over the Rust handwriting engine: triggers recognition from the
 * same save path that triggers reindex, so handwriting is re-recognized
 * whenever a note's strokes change. The heavy work (stroke clustering, the
 * per-line cache, recognition, artifact I/O) all lives in Rust on its own
 * worker. A single {@link handwritingService} instance is shared app-wide.
 *
 * Recognized artifacts are not yet consumed by search — the recognizer itself
 * is stubbed — so this client only schedules and cleans up; it holds no corpus.
 */
export class HandwritingService {
  /**
   * The repository recognition currently targets. Artifacts are namespaced per
   * repo on disk. Null between a {@link reset} and the next {@link init}.
   */
  private repoId: string | null = null;

  /** Point the service at a repository. Pair with {@link reset} on teardown. */
  init(repoId: string): void {
    this.repoId = repoId;
  }

  reset(): void {
    this.repoId = null;
  }

  /** Queue a single note for (debounced) handwriting recognition. */
  requestRecognize(nodeId: VFSNodeId, path: string, fileType: string): void {
    const repoId = this.repoId;
    if (!repoId) {
      return;
    }
    void invoke('recognize_handwriting', {
      repoId,
      nodeId,
      path,
      fileType,
    }).catch((err) => {
      logger.error('recognize_handwriting failed', err, { nodeId });
    });
  }

  /** Hand the engine a batch of candidates (startup backfill). */
  startBackfill(items: ReindexItem[]): void {
    const repoId = this.repoId;
    if (!repoId || items.length === 0) {
      return;
    }
    void invoke('recognize_handwriting_batch', { repoId, items }).catch(
      (err) => {
        logger.error('recognize_handwriting_batch failed', err);
      },
    );
  }

  /** Read a node's recognized handwriting from the on-disk artifact. */
  async readPage(nodeId: VFSNodeId): Promise<RecognizedPage | null> {
    const repoId = this.repoId;
    if (!repoId) {
      return null;
    }
    return readRecognizedPage(repoId, nodeId);
  }

  async removeRecognition(nodeId: VFSNodeId): Promise<void> {
    const repoId = this.repoId;
    if (!repoId) {
      return;
    }
    try {
      await invoke('remove_handwriting', { repoId, nodeId });
    } catch (err) {
      logger.error('remove_handwriting failed', err, { nodeId });
    }
  }
}

export const handwritingService = new HandwritingService();
