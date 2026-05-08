import { YDocManager } from '@/pages/canvas/ydoc-manager';
import type { Repository, VFSNodeId } from './types';

export type DocRewriteRepository = Pick<
  Repository,
  'getNode' | 'readFileBytes' | 'writeFileBytes'
>;

export interface RewriteDocReferencesResult {
  sourceCount: number;
  linkCount: number;
}

/**
 * For each `sourceId`, decode the doc, run `rewriteDoc` (which mutates the
 * ydoc in place and returns how many links it touched), and persist the
 * result if anything changed. Sweeps orphan page-frame fragments after a
 * non-empty rewrite. Skips non-mcanvas nodes and empty/missing bytes.
 */
export async function rewriteDocReferencesInSources(
  repository: DocRewriteRepository,
  sourceIds: readonly VFSNodeId[],
  rewriteDoc: (ydoc: YDocManager) => number,
): Promise<RewriteDocReferencesResult> {
  let sourceCount = 0;
  let linkCount = 0;
  for (const sourceId of sourceIds) {
    const node = await repository.getNode(sourceId);
    if (!node || node.type !== 'file' || node.fileType !== 'mcanvas') {
      continue;
    }

    const bytes = await repository.readFileBytes(sourceId);
    if (!bytes || bytes.byteLength === 0) {
      continue;
    }

    const ydoc = YDocManager.fromUpdate(bytes);
    const sourceLinkCount = rewriteDoc(ydoc);
    if (sourceLinkCount === 0) {
      continue;
    }
    ydoc.sweepOrphanPageFrameFragments();

    await repository.writeFileBytes(sourceId, ydoc.encodeState());
    sourceCount++;
    linkCount += sourceLinkCount;
  }

  return { sourceCount, linkCount };
}
