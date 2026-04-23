import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import type * as Y from 'yjs';
import { ElementType } from '../elements/element-type';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../elements/page-frame-constants';
import type { YDocManager } from '../ydoc-manager';
import { parseMarkdownToDoc } from './markdown-parser';
import { schema } from './pm/schema';

export const DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET = {
  x: 160,
  y: 80,
} as const;

interface AddMarkdownPageFrameOptions {
  offsetX?: number;
  offsetY?: number;
}

export function writeMarkdownToPageFrameFragment(
  markdown: string,
  fragment: Y.XmlFragment,
): void {
  const doc = parseMarkdownToDoc(markdown, schema);
  if (fragment.length > 0) {
    fragment.delete(0, fragment.length);
  }
  prosemirrorToYXmlFragment(doc, fragment);
}

export function addMarkdownPageFrameToYDoc(
  ydoc: YDocManager,
  markdown: string,
  options: AddMarkdownPageFrameOptions = {},
): number {
  const index = ydoc.nextIndex;
  ydoc.insertElementMap(0, ElementType.PAGE_FRAME, index, {
    offsetX: options.offsetX ?? DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET.x,
    offsetY: options.offsetY ?? DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET.y,
    scaleX: 1,
    scaleY: 1,
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
  });

  const fragment = ydoc.getXmlFragment(index);
  ydoc.transact(() => {
    writeMarkdownToPageFrameFragment(markdown, fragment);
    ydoc.nextIndex = Math.max(ydoc.nextIndex, index + 1);
  });

  return index;
}
