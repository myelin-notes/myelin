import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { renamePageFrameLinkReferencesDoc } from '@/pages/canvas/page-frame/pm/markdown/note-links';
import { schema } from '@/pages/canvas/page-frame/pm/schema';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import type { Repository, VFSNodeId } from './types';

type PageFrameReferenceRepository = Pick<
  Repository,
  'getBacklinks' | 'getNode' | 'readFileBytes' | 'writeFileBytes'
>;

export interface RenamePageFrameReferencesResult {
  sourceCount: number;
  linkCount: number;
}

function renamePageFrameReferencesInDoc(
  ydoc: YDocManager,
  pageFrameId: string,
  newName: string,
): number {
  let linkCount = 0;

  ydoc.transact(() => {
    for (let i = 0; i < ydoc.elements.length; i++) {
      const yMap = ydoc.elements.get(i);
      if (yMap.get('type') !== ElementType.PAGE_FRAME) {
        continue;
      }

      const uuid = yMap.get('uuid');
      if (typeof uuid !== 'string') {
        continue;
      }

      const fragment = ydoc.getXmlFragment(uuid);
      if (fragment.length === 0) {
        continue;
      }

      const currentDoc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
      const result = renamePageFrameLinkReferencesDoc(
        currentDoc,
        schema,
        pageFrameId,
        newName,
      );
      if (result.count === 0) {
        continue;
      }

      fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(result.doc, fragment);
      linkCount += result.count;
    }
  });

  return linkCount;
}

/**
 * Rewrites note-links across all docs that reference `ownerNoteId` so any link
 * with `pageFrameId === frameId` gets `#oldName` swapped for `#newName` in its
 * title. The owner doc is skipped — callers must update its open editor in
 * place to avoid clobbering live Y.js state.
 */
export async function renamePageFrameReferences(
  repository: PageFrameReferenceRepository,
  ownerNoteId: VFSNodeId,
  pageFrameId: string,
  newName: string,
): Promise<RenamePageFrameReferencesResult> {
  const backlinks = await repository.getBacklinks(ownerNoteId);
  const sourceIds = [
    ...new Set(
      backlinks
        .filter((backlink) => backlink.targetId === ownerNoteId)
        .map((backlink) => backlink.sourceId),
    ),
  ].filter((sourceId) => sourceId !== ownerNoteId);

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
    const sourceLinkCount = renamePageFrameReferencesInDoc(
      ydoc,
      pageFrameId,
      newName,
    );
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
