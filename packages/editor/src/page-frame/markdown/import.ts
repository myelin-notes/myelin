import { Fragment, type Node as PMNode } from 'prosemirror-model';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import type * as Y from 'yjs';
import { ElementType } from '../../elements/element-type';
import {
  normalizePageFrameDisplayName,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type PageLayout,
} from '../../elements/page-frame-constants';
import type { VFSNodeId } from '../../sync/types';
import type { YDocManager } from '../../ydoc-manager';
import {
  type NoteLinkRefResolveSource,
  resolveNoteLinkRefByTitle,
} from '../note-link/resolution';
import {
  normalizeAndResolveNoteLinksDoc,
  type ResolveNoteLink,
} from '../pm/markdown/note-links';
import { schema } from '../pm/schema';
import {
  CONTENT_FORMAT_KEY,
  PAGE_FRAME_CONTENT_FORMAT,
} from './legacy-content';
import { parseMarkdownToDoc } from './parser';
import { serializeBlock } from './serializer';

export const DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET = {
  x: 160,
  y: 80,
} as const;

interface MarkdownPageFrameImportOptions {
  repository?: NoteLinkRefResolveSource;
  resolveNoteLinkId?: (title: string) => Promise<VFSNodeId | null>;
}

interface AddMarkdownPageFrameOptions extends MarkdownPageFrameImportOptions {
  offsetX?: number;
  offsetY?: number;
  displayName?: string;
  pageLayout?: PageLayout;
}

async function buildMarkdownPageFrameDoc(
  markdown: string,
  options: MarkdownPageFrameImportOptions = {},
): Promise<PMNode> {
  const doc = parseMarkdownToDoc(markdown, schema);
  const resolveNoteLink = pickResolveNoteLink(options);
  return normalizeAndResolveNoteLinksDoc(doc, schema, resolveNoteLink);
}

function pickResolveNoteLink(
  options: MarkdownPageFrameImportOptions,
): ResolveNoteLink | undefined {
  if (options.resolveNoteLinkId) {
    const fn = options.resolveNoteLinkId;
    return async (title) => ({
      noteId: await fn(title),
      pageFrameId: null,
    });
  }
  const repository = options.repository;
  if (repository) {
    return async (title) => resolveNoteLinkRefByTitle(repository, title);
  }
  return undefined;
}

// Markdown can't express color, fonts, figure widths or column sizes. A block whose markdown didn't
// change keeps its existing node, so rewriting a document only loses styling on blocks actually edited.
export function preserveUnchangedBlocks(current: PMNode, next: PMNode): PMNode {
  const existing = new Map<string, PMNode[]>();
  current.forEach((node) => {
    const key = serializeBlock(node);
    if (key !== null) {
      existing.set(key, [...(existing.get(key) ?? []), node]);
    }
  });
  const blocks: PMNode[] = [];
  next.forEach((node) => {
    const key = serializeBlock(node);
    blocks.push((key !== null && existing.get(key)?.shift()) || node);
  });
  return next.copy(Fragment.fromArray(blocks));
}

// Updates in place rather than clearing first: y-prosemirror diffs against the fragment, so
// unchanged blocks keep their Yjs identity and any ink anchored to them stays attached.
function replacePageFrameFragmentDoc(
  fragment: Y.XmlFragment,
  doc: PMNode,
): void {
  const merged =
    fragment.length > 0
      ? preserveUnchangedBlocks(
          yXmlFragmentToProseMirrorRootNode(fragment, schema),
          doc,
        )
      : doc;
  prosemirrorToYXmlFragment(merged, fragment);
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
    pageLayout: options.pageLayout ?? 'vertical',
    [CONTENT_FORMAT_KEY]: PAGE_FRAME_CONTENT_FORMAT,
  });

  const fragment = ydoc.getXmlFragment(uuid);
  ydoc.transact(() => {
    replacePageFrameFragmentDoc(fragment, doc);
  });

  return uuid;
}
