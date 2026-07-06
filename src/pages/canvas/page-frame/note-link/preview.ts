import type { Repository, VFSNodeId, YjsSyncTarget } from '@/lib/sync/core';
import { extractCanvasPreviewText } from '../preview-text';
import { isCanvasNote, resolveNoteLinkIdByTitle } from './resolution';

export interface NoteLinkPreviewTarget {
  title: string;
  noteId: VFSNodeId | null;
}

export interface NoteLinkPreview {
  noteId: VFSNodeId;
  title: string;
  body: string;
}

export type NoteLinkPreviewSource = Pick<
  Repository,
  'getNode' | 'searchNodes' | 'getFolderChain'
> &
  Pick<YjsSyncTarget, 'loadDocument'>;

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export async function getNoteLinkPreview(
  repository: NoteLinkPreviewSource,
  target: NoteLinkPreviewTarget,
  signal?: AbortSignal,
): Promise<NoteLinkPreview | null> {
  if (isAborted(signal)) {
    return null;
  }

  const noteId =
    target.noteId ?? (await resolveNoteLinkIdByTitle(repository, target.title));
  if (!noteId || isAborted(signal)) {
    return null;
  }

  const node = await repository.getNode(noteId);
  if (!isCanvasNote(node) || isAborted(signal)) {
    return null;
  }

  const snapshot = await repository.loadDocument(noteId);
  if (isAborted(signal)) {
    return null;
  }

  return {
    noteId,
    title: node.name || target.title,
    body: extractCanvasPreviewText(snapshot.update) || 'Empty note',
  };
}
