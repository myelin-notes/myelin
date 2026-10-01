import type { NativeRepository } from './native';
import type { NoteBacklink, VFSNodeId } from './types';

export interface RenameNoteReferencesResult {
  sourceCount: number;
  linkCount: number;
}

export async function renameNoteReferences(
  repository: Pick<NativeRepository, 'getBacklinks' | 'renameReferences'>,
  noteId: VFSNodeId,
  newName: string,
  backlinks?: readonly NoteBacklink[],
): Promise<RenameNoteReferencesResult> {
  const references = backlinks ?? (await repository.getBacklinks(noteId));
  const sourceIds = [
    ...new Set(
      references
        .filter((backlink) => backlink.targetId === noteId)
        .map((backlink) => backlink.sourceId),
    ),
  ];

  return repository.renameReferences({
    sourceIds,
    targetId: noteId,
    newName,
    referenceKind: 'note',
  });
}
