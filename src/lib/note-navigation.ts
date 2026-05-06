import type { NavigateFunction } from 'react-router-dom';
import type { FileId, FileType, Repository } from '@/lib/sync';
import { parseNoteLinkTarget } from './note-link-target';

export interface NoteRouteTarget {
  fileType: FileType;
  id: FileId;
  pageFrameName?: string | null;
}

export interface NoteLinkRouteTarget {
  title: string;
  noteId: FileId | null;
}

export type NoteLinkRepository = Pick<Repository, 'createFile' | 'getNode'>;

export function getNotePath({
  fileType,
  id,
  pageFrameName,
}: NoteRouteTarget): string {
  const path = `/${fileType}/${id}`;
  return pageFrameName ? `${path}#${encodeURIComponent(pageFrameName)}` : path;
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
  currentNoteId: FileId,
  target: NoteLinkRouteTarget,
): Promise<void> {
  const parsedTarget = parseNoteLinkTarget(target.title);
  const noteTitle = parsedTarget?.noteTarget ?? target.title;
  let noteId = target.noteId;
  if (!noteId) {
    const currentNode = await repository.getNode(currentNoteId);
    const parentId = currentNode?.type === 'file' ? currentNode.parentId : null;
    noteId = await repository.createFile(noteTitle, 'mcanvas', parentId);
  }

  openNote(navigate, {
    fileType: 'mcanvas',
    id: noteId,
    pageFrameName: parsedTarget?.pageFrameName ?? null,
  });
}
