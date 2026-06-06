import type { FileType, Repository, VFSNodeId } from '@/lib/sync';
import type { TabStateController } from '@/lib/tabs/controller';
import type { TabTarget } from '@/lib/tabs/types';
import { parseNoteLinkTarget } from './link-target';

export interface NoteRouteTarget {
  fileType: FileType;
  id: VFSNodeId;
  pageFrameName?: string | null;
  pageFrameId?: string | null;
}

export interface NoteLinkRouteTarget {
  title: string;
  noteId: VFSNodeId | null;
  pageFrameId?: string | null;
}

export type NoteLinkRepository = Pick<Repository, 'createFile' | 'getNode'>;

function noteTargetToTabTarget(target: NoteRouteTarget): TabTarget {
  if (target.fileType === 'mcanvas') {
    return {
      type: 'canvas',
      id: target.id,
      pageFrameName: target.pageFrameName ?? null,
      pageFrameId: target.pageFrameId ?? null,
    };
  }
  return {
    type: 'image',
    id: target.id,
    fileType: target.fileType,
  };
}

export function openNote(
  controller: TabStateController,
  target: NoteRouteTarget,
  title?: string,
): void {
  const tabTarget = noteTargetToTabTarget(target);
  const tabTitle = title ?? target.id;
  controller.openTab(tabTarget, tabTitle);
}

export async function openNoteLink(
  controller: TabStateController,
  repository: NoteLinkRepository,
  currentNoteId: VFSNodeId,
  target: NoteLinkRouteTarget,
): Promise<void> {
  const parsedTarget = parseNoteLinkTarget(target.title);
  const noteTitle = parsedTarget?.path ?? target.title;
  let noteId = target.noteId;
  if (!noteId) {
    const currentNode = await repository.getNode(currentNoteId);
    const parentId = currentNode?.type === 'file' ? currentNode.parentId : null;
    noteId = await repository.createFile(noteTitle, 'mcanvas', parentId);
  }

  openNote(
    controller,
    {
      fileType: 'mcanvas',
      id: noteId,
      pageFrameName: parsedTarget?.pageFrameName ?? null,
      pageFrameId: target.pageFrameId ?? null,
    },
    noteTitle,
  );
}
