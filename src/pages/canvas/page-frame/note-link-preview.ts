import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type {
  FileId,
  Repository,
  VFSFileNode,
  VFSNode,
  YjsSyncTarget,
} from '@/lib/sync';
import { ElementType } from '../elements/element-type';
import { YDocManager } from '../ydoc-manager';
import { resolveNoteLinkIdByTitle } from './note-link-resolution';
import { schema } from './pm/schema';

const MAX_PREVIEW_LENGTH = 360;

export interface NoteLinkPreviewTarget {
  title: string;
  noteId: FileId | null;
}

export interface NoteLinkPreview {
  noteId: FileId;
  title: string;
  body: string;
}

export type NoteLinkPreviewSource = Pick<
  Repository,
  'getNode' | 'searchNodes' | 'getFolderChain'
> &
  Pick<YjsSyncTarget, 'loadDocument'>;

function isCanvasNote(node: VFSNode | null): node is VFSFileNode {
  return node?.type === 'file' && node.fileType === 'mcanvas';
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function normalizePreviewText(text: string): string {
  return text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncatePreviewText(text: string): string {
  if (text.length <= MAX_PREVIEW_LENGTH) {
    return text;
  }

  const truncated = text.slice(0, MAX_PREVIEW_LENGTH - 3).trimEnd();
  const wordBoundary = truncated.lastIndexOf(' ');
  if (wordBoundary > MAX_PREVIEW_LENGTH * 0.7) {
    return `${truncated.slice(0, wordBoundary).trimEnd()}...`;
  }
  return `${truncated}...`;
}

function extractPreviewText(update: Uint8Array | null): string {
  if (!update || update.byteLength === 0) {
    return '';
  }

  const ydoc = YDocManager.fromUpdate(update);
  const pageFrameTexts: string[] = [];

  for (let i = 0; i < ydoc.elements.length; i++) {
    const yMap = ydoc.elements.get(i);
    if (yMap.get('type') !== ElementType.PAGE_FRAME) {
      continue;
    }

    const index = yMap.get('index');
    if (typeof index !== 'number') {
      continue;
    }

    const fragment = ydoc.getXmlFragment(index);
    if (fragment.length === 0) {
      continue;
    }

    const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    const text = normalizePreviewText(
      doc.textBetween(0, doc.content.size, '\n', ' '),
    );
    if (text) {
      pageFrameTexts.push(text);
    }
  }

  return truncatePreviewText(pageFrameTexts.join('\n\n'));
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
    body: extractPreviewText(snapshot.update) || 'Empty note',
  };
}
