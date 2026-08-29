import { parseNoteLinkTarget } from '@myelin/editor/note/link-target';
import { trackEvent } from '@/lib/analytics';
import {
  type FileType,
  isDataFileType,
  type Repository,
  type VFSNodeId,
} from '@/lib/sync';
import type { TabStateController } from '@/lib/tabs/controller';
import type { TabTarget } from '@/lib/tabs/types';
import { createBlankCanvasFile } from './create';

export type NoteOpenSource =
  | 'explorer'
  | 'recent_files'
  | 'search'
  | 'graph'
  | 'note_link'
  | 'backlink';

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
  if (target.fileType === 'mcanvas') {
    return {
      type: 'canvas',
      id: target.id,
      pageFrameName: target.pageFrameName ?? null,
      pageFrameId: target.pageFrameId ?? null,
    };
  }
  if (isDataFileType(target.fileType)) {
    return { type: 'csv', id: target.id };
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
  title: string | undefined,
  source: NoteOpenSource,
): void {
  const tabTarget = noteTargetToTabTarget(target);
  const tabTitle = title ?? target.id;
  controller.openTab(tabTarget, tabTitle);
  trackEvent('note_opened', { file_type: target.fileType, source });
}

export async function openNoteLink(
  controller: TabStateController,
  repository: Repository,
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
    'note_link',
  );
}
