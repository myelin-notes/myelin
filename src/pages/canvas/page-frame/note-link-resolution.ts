import type { Repository, VFSFileNode, VFSNode } from '@/lib/sync';
import type { PageFrameAutocompleteItem } from './pm/autocomplete';

export type NoteLinkResolveSource = Pick<Repository, 'searchNodes'>;
export type NoteLinkSearchSource = Pick<
  Repository,
  'searchNodes' | 'getFolderChain'
>;

// todo: probably can avoid searching
export async function resolveNoteLinkIdByTitle(
  repository: NoteLinkResolveSource,
  title: string,
): Promise<string | null> {
  const matches = await repository.searchNodes(title);
  const match = matches.find(
    (node) =>
      node.type === 'file' &&
      node.fileType === 'mcanvas' &&
      node.name === title,
  );
  return match?.id ?? null;
}

export async function searchNoteLinkAutocompleteItems(
  repository: NoteLinkSearchSource,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<readonly PageFrameAutocompleteItem[]> {
  const matches = await repository.searchNodes(query);
  if (signal.aborted) {
    return [];
  }

  const notes = matches.filter(isCanvasNote).slice(0, limit);
  const foldersByNoteId = await Promise.all(
    notes.map((note) => repository.getFolderChain(note.parentId)),
  );

  if (signal.aborted) {
    return [];
  }

  return notes.map((note, index) => {
    const folderPath = foldersByNoteId[index]
      .map((folder) => folder.name)
      .join(' / ');

    return {
      id: note.id,
      title: note.name,
      subtitle: folderPath || 'Root',
    };
  });
}

function isCanvasNote(node: VFSNode): node is VFSFileNode {
  return node.type === 'file' && node.fileType === 'mcanvas';
}
