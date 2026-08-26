import type {
  HandwritingCapability,
  RecognizedPage,
  ReindexItem,
} from '@myelin/editor/platform/types';
import type { VFSNodeId } from '@myelin/editor/sync/types';
import { Logger } from '@myelin/shared/logger';
import { invoke } from '@tauri-apps/api/core';
import { BaseDirectory, exists, readTextFile } from '@tauri-apps/plugin-fs';

const logger = new Logger('HandwritingService');

const HANDWRITING_DIR = 'Handwriting';
const SUFFIX = '.json';

function relPath(repoId: string, nodeId: VFSNodeId): string {
  return `${HANDWRITING_DIR}/${repoId}/${nodeId}${SUFFIX}`;
}

// The on-disk artifact is written by the Rust handwriting engine; the field shape is a
// cross-language contract (see `src-tauri/src/handwriting/store.rs`).
async function readRecognizedPage(
  repoId: string,
  nodeId: VFSNodeId,
): Promise<RecognizedPage | null> {
  const rel = relPath(repoId, nodeId);
  if (!(await exists(rel, { baseDir: BaseDirectory.AppCache }))) {
    return null;
  }
  try {
    const json = await readTextFile(rel, { baseDir: BaseDirectory.AppCache });
    return JSON.parse(json) as RecognizedPage;
  } catch {
    return null;
  }
}

/**
 * Thin client over the Rust handwriting engine, triggered from the same save path as reindex so
 * handwriting is re-recognized whenever a note's strokes change. The heavy work — stroke
 * clustering, the per-line cache, recognition, artifact I/O — lives in Rust on its own worker.
 * This client holds no in-memory corpus; search pulls a page on demand via {@link readPage}.
 */
export class TauriHandwritingService implements HandwritingCapability {
  // Artifacts are namespaced per repo on disk. Null between a {@link reset} and the next {@link init}.
  private repoId: string | null = null;

  init(repoId: string): void {
    this.repoId = repoId;
  }

  reset(): void {
    this.repoId = null;
  }

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
