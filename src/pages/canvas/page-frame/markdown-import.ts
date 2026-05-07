import type { Node as PMNode } from 'prosemirror-model';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import type * as Y from 'yjs';
import type { VFSNodeId } from '@/lib/sync';
import { ElementType } from '../elements/element-type';
import {
  normalizePageFrameDisplayName,
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from '../elements/page-frame-constants';
import type { YDocManager } from '../ydoc-manager';
import { parseMarkdownToDoc } from './markdown-parser';
import {
  type NoteLinkResolveSource,
  resolveNoteLinkIdByTitle,
} from './note-link-resolution';
import { normalizeAndResolveNoteLinksDoc } from './pm/markdown/note-links';
import { schema } from './pm/schema';

export const DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET = {
  x: 160,
  y: 80,
} as const;

interface MarkdownPageFrameImportOptions {
  repository?: NoteLinkResolveSource;
  resolveNoteLinkId?: (title: string) => Promise<VFSNodeId | null>;
}

interface AddMarkdownPageFrameOptions extends MarkdownPageFrameImportOptions {
  offsetX?: number;
  offsetY?: number;
  displayName?: string;
}

async function buildMarkdownPageFrameDoc(
  markdown: string,
  options: MarkdownPageFrameImportOptions = {},
): Promise<PMNode> {
  const doc = parseMarkdownToDoc(markdown, schema);
  const repository = options.repository;
  const resolveNoteLinkId = options.resolveNoteLinkId
    ? options.resolveNoteLinkId
    : repository
      ? async (title: string) => resolveNoteLinkIdByTitle(repository, title)
      : undefined;
  return normalizeAndResolveNoteLinksDoc(doc, schema, resolveNoteLinkId);
}

function replacePageFrameFragmentDoc(
  fragment: Y.XmlFragment,
  doc: PMNode,
): void {
  if (fragment.length > 0) {
    fragment.delete(0, fragment.length);
  }
  prosemirrorToYXmlFragment(doc, fragment);
}

export async function writeMarkdownToPageFrameFragment(
  markdown: string,
  fragment: Y.XmlFragment,
  options: MarkdownPageFrameImportOptions = {},
): Promise<void> {
  const doc = await buildMarkdownPageFrameDoc(markdown, options);
  const ydoc = fragment.doc;
  if (ydoc) {
    ydoc.transact(() => {
      replacePageFrameFragmentDoc(fragment, doc);
    });
    return;
  }
  replacePageFrameFragmentDoc(fragment, doc);
}

export async function addMarkdownPageFrameToYDoc(
  ydoc: YDocManager,
  markdown: string,
  options: AddMarkdownPageFrameOptions = {},
): Promise<string> {
  const doc = await buildMarkdownPageFrameDoc(markdown, options);
  const uuid = crypto.randomUUID();
  ydoc.insertElementMap(0, ElementType.PAGE_FRAME, uuid, {
    offsetX: options.offsetX ?? DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET.x,
    offsetY: options.offsetY ?? DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET.y,
    scaleX: 1,
    scaleY: 1,
    displayName: normalizePageFrameDisplayName(options.displayName),
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
  });

  const fragment = ydoc.getXmlFragment(uuid);
  ydoc.transact(() => {
    replacePageFrameFragmentDoc(fragment, doc);
  });

  return uuid;
}
