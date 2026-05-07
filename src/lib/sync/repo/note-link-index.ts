import type { Node as PMNode } from 'prosemirror-model';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type * as Y from 'yjs';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { schema } from '@/pages/canvas/page-frame/pm/schema';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import type { StoredNoteLink, VFSNodeId } from './types';

const MAX_SNIPPET_LENGTH = 180;

function normalizeSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateSnippet(text: string): string {
  if (text.length <= MAX_SNIPPET_LENGTH) {
    return text;
  }

  const truncated = text.slice(0, MAX_SNIPPET_LENGTH - 3).trimEnd();
  const wordBoundary = truncated.lastIndexOf(' ');
  if (wordBoundary > MAX_SNIPPET_LENGTH * 0.7) {
    return `${truncated.slice(0, wordBoundary).trimEnd()}...`;
  }
  return `${truncated}...`;
}

function getBlockSnippet(node: PMNode): string {
  return truncateSnippet(
    normalizeSnippet(node.textBetween(0, node.content.size, ' ', ' ')),
  );
}

function getLinkKey(link: StoredNoteLink): string {
  return `${link.targetId ?? ''}\0${link.title}`;
}

function collectBlockLinks(node: PMNode, links: StoredNoteLink[]): void {
  const noteLinkType = schema.marks.noteLink;
  if (!noteLinkType) {
    return;
  }

  const snippet = getBlockSnippet(node);
  let previousLinkKey: string | null = null;

  node.forEach((child) => {
    if (!child.isText) {
      previousLinkKey = null;
      return;
    }

    const noteLinkMark = child.marks.find((mark) => mark.type === noteLinkType);
    if (!noteLinkMark) {
      previousLinkKey = null;
      return;
    }

    const title = noteLinkMark.attrs.title;
    if (typeof title !== 'string' || title.length === 0) {
      previousLinkKey = null;
      return;
    }

    const noteId = noteLinkMark.attrs.noteId;
    const link: StoredNoteLink = {
      targetId:
        typeof noteId === 'string' && noteId.length > 0
          ? (noteId as VFSNodeId)
          : null,
      title,
      snippet,
    };
    const linkKey = getLinkKey(link);
    if (linkKey !== previousLinkKey) {
      links.push(link);
    }
    previousLinkKey = linkKey;
  });
}

export function extractStoredNoteLinks(doc: Y.Doc): StoredNoteLink[] {
  const ydoc = new YDocManager(doc);
  const links: StoredNoteLink[] = [];

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

    const pageFrameDoc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    pageFrameDoc.descendants((node) => {
      if (!node.isTextblock || node.type.spec.code) {
        return true;
      }

      collectBlockLinks(node, links);
      return false;
    });
  }

  return links;
}
