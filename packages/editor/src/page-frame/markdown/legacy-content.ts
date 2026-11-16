import type { Node as PMNode } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import type * as Y from 'yjs';
import { figureFromParagraph } from '../pm/figure/plugin';
import { convertInlineMarkdownInBlock } from '../pm/markdown/inline-marks';
import { schema } from '../pm/schema';

/**
 * Frames at this format store bold, italic and inline code as marks and sole-image paragraphs as
 * figures. Earlier ones kept the literal markdown and styled it with decorations. The marker has to
 * be persisted: text like `\*x\*` is legitimately literal once a frame is at this format.
 */
export const PAGE_FRAME_CONTENT_FORMAT = 2;
export const CONTENT_FORMAT_KEY = 'contentFormat';

export function migrateLegacyDoc(doc: PMNode): PMNode {
  const tr = new Transform(doc);
  const blocks: Array<{ node: PMNode; pos: number; topLevel: boolean }> = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isTextblock) {
      return true;
    }
    if (!node.type.spec.code) {
      blocks.push({ node, pos, topLevel: parent === doc });
    }
    return false;
  });
  for (const { node, pos, topLevel } of blocks.reverse()) {
    const figure = topLevel ? figureFromParagraph(node, schema) : null;
    if (figure) {
      tr.replaceWith(pos, pos + node.nodeSize, figure);
    } else {
      convertInlineMarkdownInBlock(tr, node, pos, schema);
    }
  }
  return tr.doc;
}

/** Idempotent. An empty fragment is left unmarked, since its content may not have synced yet. */
export function migrateLegacyPageFrameContent(
  yMap: Y.Map<unknown>,
  fragment: Y.XmlFragment,
): void {
  if (
    yMap.get(CONTENT_FORMAT_KEY) === PAGE_FRAME_CONTENT_FORMAT ||
    fragment.length === 0
  ) {
    return;
  }
  const migrate = () => {
    const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    const migrated = migrateLegacyDoc(doc);
    if (!migrated.eq(doc)) {
      prosemirrorToYXmlFragment(migrated, fragment);
    }
    yMap.set(CONTENT_FORMAT_KEY, PAGE_FRAME_CONTENT_FORMAT);
  };
  // A non-null origin keeps this out of the user's undo stack.
  if (fragment.doc) {
    fragment.doc.transact(migrate, 'page-frame-content-migration');
  } else {
    migrate();
  }
}

/** The doc for read-only consumers, which can reach frames no canvas has opened and migrated. */
export function readPageFrameDoc(
  yMap: Y.Map<unknown>,
  fragment: Y.XmlFragment,
): PMNode {
  const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
  return yMap.get(CONTENT_FORMAT_KEY) === PAGE_FRAME_CONTENT_FORMAT
    ? doc
    : migrateLegacyDoc(doc);
}
