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

// Positions in `current` and `merged` holding the same reused node, in order: the blocks the
// rewrite leaves alone.
function keptBlockPairs(current: PMNode, merged: PMNode): [number, number][] {
  const a = current.content.content;
  const b = merged.content.content;
  // Common ends first, so a typical one-region edit never builds the O(n·m) table.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++;
  }
  const n = a.length - start - end;
  const m = b.length - start - end;
  const lengths = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * (m + 1) + j] =
        a[start + i] === b[start + j]
          ? lengths[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(
              lengths[(i + 1) * (m + 1) + j],
              lengths[i * (m + 1) + j + 1],
            );
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) {
    pairs.push([i, i]);
  }
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[start + i] === b[start + j]) {
      pairs.push([start + i, start + j]);
      i++;
      j++;
    } else if (lengths[(i + 1) * (m + 1) + j] >= lengths[i * (m + 1) + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  for (let k = end; k > 0; k--) {
    pairs.push([a.length - k, b.length - k]);
  }
  return pairs;
}

// y-prosemirror only keeps the unchanged runs at the two ends of a document; blocks between two
// edited regions are overwritten in place, which moves any ink anchored to them onto other text.
// Applying one region at a time keeps every unchanged block inside one of those end runs.
function replacePageFrameFragmentDoc(
  fragment: Y.XmlFragment,
  doc: PMNode,
): void {
  if (fragment.length === 0) {
    prosemirrorToYXmlFragment(doc, fragment);
    return;
  }
  const current = yXmlFragmentToProseMirrorRootNode(fragment, schema);
  const merged = preserveUnchangedBlocks(current, doc);
  const working = [...current.content.content];
  let shift = 0;
  let oldStart = 0;
  let newStart = 0;
  const regionEnds: [number, number][] = [
    ...keptBlockPairs(current, merged),
    [current.childCount, merged.childCount],
  ];
  for (const [oldEnd, newEnd] of regionEnds) {
    if (oldEnd > oldStart || newEnd > newStart) {
      working.splice(
        oldStart + shift,
        oldEnd - oldStart,
        ...merged.content.content.slice(newStart, newEnd),
      );
      shift += newEnd - newStart - (oldEnd - oldStart);
      prosemirrorToYXmlFragment(
        merged.copy(Fragment.fromArray(working)),
        fragment,
      );
    }
    oldStart = oldEnd + 1;
    newStart = newEnd + 1;
  }
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
