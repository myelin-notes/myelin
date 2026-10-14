import type { NativeRepository } from './native';
import type { NoteBacklink, VFSNodeId } from './types';

export interface RenamePageFrameReferencesResult {
  sourceCount: number;
  linkCount: number;
}

/**
 * Rewrites note-links across all docs that reference `ownerNoteId` so any link
 * with `pageFrameId === frameId` gets `#oldName` swapped for `#newName` in its
 * title. The owner doc is skipped — callers must update its open editor in
 * place to avoid clobbering live Y.js state.
 */
export async function renamePageFrameReferences(
  repository: Pick<NativeRepository, 'getBacklinks' | 'renameReferences'>,
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

  return repository.renameReferences({
    sourceIds,
    targetId: pageFrameId,
    newName,
    referenceKind: 'page-frame',
  });
}
