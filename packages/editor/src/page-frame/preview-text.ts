import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { ElementType } from '../elements/element-type';
import { YDocManager } from '../ydoc-manager';
import { schema } from './pm/schema';

const MAX_PREVIEW_LENGTH = 360;

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

export function extractCanvasPreviewText(update: Uint8Array | null): string {
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

    const uuid = yMap.get('uuid');
    if (typeof uuid !== 'string') {
      continue;
    }

    const fragment = ydoc.getXmlFragment(uuid);
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
