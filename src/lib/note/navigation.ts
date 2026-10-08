import { parseNoteLinkTarget } from '@myelin/editor/note/link-target';
import {
  type FileType,
  getFileViewer,
  type NativeRepository,
  type VFSNodeId,
} from '@/lib/sync';
import type { TabStateController } from '@/lib/tabs/controller';
import type { TabTarget } from '@/lib/tabs/types';
import { createBlankCanvasFile } from './create';

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

function noteTargetToTabTarget(target: NoteRouteTarget): TabTarget {
  switch (getFileViewer(target.fileType)) {
    case 'canvas':
      return {
        type: 'canvas',
        id: target.id,
        pageFrameName: target.pageFrameName ?? null,
        pageFrameId: target.pageFrameId ?? null,
      };
    case 'csv':
      return { type: 'csv', id: target.id };
    case 'image':
      return {
        type: 'image',
        id: target.id,
        fileType: target.fileType,
      };
    case 'unsupported':
      return {
        type: 'unsupported',
        id: target.id,
        fileType: target.fileType,
      };
  }
}

export function openNote(
  controller: TabStateController,
  target: NoteRouteTarget,
  title: string | undefined,
): void {
  const tabTarget = noteTargetToTabTarget(target);
  const tabTitle = title ?? target.id;
  controller.openTab(tabTarget, tabTitle);
}

export async function openNoteLink(
  controller: TabStateController,
  repository: NativeRepository,
  currentNoteId: VFSNodeId,
  target: NoteLinkRouteTarget,
): Promise<void> {
  const parsedTarget = parseNoteLinkTarget(target.title);
  const noteTitle = parsedTarget?.path ?? target.title;
  let noteId = target.noteId;
  if (!noteId) {
    const currentNode = await repository.getNode(currentNoteId);
    const parentId = currentNode?.type === 'file' ? currentNode.parentId : null;
    noteId = await createBlankCanvasFile(
      repository,
      noteTitle,
      parentId,
      parsedTarget?.pageFrameName,
    );
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
