import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { renamePageFrameLinkReferencesDoc } from '@/pages/canvas/page-frame/pm/markdown/note-links';
import { schema } from '@/pages/canvas/page-frame/pm/schema';
import type { YDocManager } from '@/pages/canvas/ydoc-manager';
import {
  type DocRewriteRepository,
  rewriteDocReferencesInSources,
} from './rewrite-doc-references';
import type { NoteBacklink, Repository, VFSNodeId } from './types';

type PageFrameReferenceRepository = DocRewriteRepository &
  Pick<Repository, 'getBacklinks'>;

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
  backlinks?: readonly NoteBacklink[],
): Promise<RenamePageFrameReferencesResult> {
  const references = backlinks ?? (await repository.getBacklinks(ownerNoteId));
  const sourceIds = [
    ...new Set(
      references
        .filter((backlink) => backlink.targetId === ownerNoteId)
        .map((backlink) => backlink.sourceId),
    ),
  ].filter((sourceId) => sourceId !== ownerNoteId);

  return rewriteDocReferencesInSources(repository, sourceIds, (ydoc) =>
    renamePageFrameReferencesInDoc(ydoc, pageFrameId, newName),
  );
}
