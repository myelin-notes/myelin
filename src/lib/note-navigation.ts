import type { NavigateFunction } from 'react-router-dom';
import type { FileType, Repository } from '@/lib/sync';

export interface NoteRouteTarget {
  fileType: FileType;
  id: string;
}

export interface NoteLinkRouteTarget {
  title: string;
  noteId: string | null;
}

export type NoteLinkRepository = Pick<Repository, 'createFile' | 'getNode'>;

export function getNotePath({ fileType, id }: NoteRouteTarget): string {
  return `/${fileType}/${id}`;
}

export function openNote(
  navigate: NavigateFunction,
  target: NoteRouteTarget,
): void {
  navigate(getNotePath(target), { viewTransition: true });
}

export async function openNoteLink(
  navigate: NavigateFunction,
  repository: NoteLinkRepository,
  currentNoteId: string,
  target: NoteLinkRouteTarget,
): Promise<void> {
  let noteId = target.noteId;
  if (!noteId) {
    const currentNode = await repository.getNode(currentNoteId);
    const parentId = currentNode?.type === 'file' ? currentNode.parentId : null;
    noteId = await repository.createFile(target.title, 'mcanvas', parentId);
  }

  openNote(navigate, { fileType: 'mcanvas', id: noteId });
}
