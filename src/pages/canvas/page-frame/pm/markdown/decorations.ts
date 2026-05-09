import type { Node as PMNode } from 'prosemirror-model';
import { Decoration } from 'prosemirror-view';
import { parseFenceMarkdown } from './parse-fences';
import { parseInlineMarkdown } from './parse-inline';
import { type InlinePreviewKind, MARKDOWN_ATOM_CHAR } from './types';

const INLINE_CLASS_BY_KIND: Record<InlinePreviewKind, string> = {
  bold: 'pm-md-bold',
  italic: 'pm-md-italic',
  inlineCode: 'pm-md-inline-code',
  noteLink: 'pm-md-note-link',
};

interface TextOffsetMap {
  text: string;
  posAt: number[];
}

function buildTextOffsetMap(node: PMNode, pos: number): TextOffsetMap {
  const parts: string[] = [];
  const posAt = [pos + 1];
  let cursorPos = pos + 1;

  node.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? '';
      parts.push(text);
      for (let i = 0; i < text.length; i++) {
        cursorPos += 1;
        posAt.push(cursorPos);
      }
      return;
    }

    parts.push(MARKDOWN_ATOM_CHAR);
    cursorPos += child.nodeSize;
    posAt.push(cursorPos);
  });

  return {
    text: parts.join(''),
    posAt,
  };
}

function addInlineDecorations(
  node: PMNode,
  pos: number,
  decorations: Decoration[],
): void {
  const { text, posAt } = buildTextOffsetMap(node, pos);
  if (!text.includes('`') && !text.includes('*') && !text.includes('[')) {
    return;
  }

  const parsed = parseInlineMarkdown(text);
  for (const range of parsed.ranges) {
    decorations.push(
      Decoration.inline(posAt[range.open.from], posAt[range.open.to], {
        class: 'pm-md-delim',
      }),
    );
    decorations.push(
      Decoration.inline(posAt[range.close.from], posAt[range.close.to], {
        class: 'pm-md-delim',
      }),
    );
    if (range.contentFrom < range.contentTo) {
      decorations.push(
        Decoration.inline(posAt[range.contentFrom], posAt[range.contentTo], {
          class: INLINE_CLASS_BY_KIND[range.kind],
        }),
      );
    }
    if (range.kind === 'noteLink') {
      addNoteLinkEscapeDecorations(
        text,
        posAt,
        range.contentFrom,
        range.contentTo,
        decorations,
      );
    }
  }
}

function addNoteLinkEscapeDecorations(
  text: string,
  posAt: number[],
  contentFrom: number,
  contentTo: number,
  decorations: Decoration[],
): void {
  let i = contentFrom;
  while (i < contentTo) {
    if (text[i] === '\\' && i + 1 < contentTo) {
      decorations.push(
        Decoration.inline(posAt[i], posAt[i + 1], { class: 'pm-md-delim' }),
      );
      i += 2;
      continue;
    }
    i += 1;
  }
}

function addFenceDecorations(
  node: PMNode,
  pos: number,
  decorations: Decoration[],
): void {
  const text = node.textContent;
  if (!text.includes('`')) {
    return;
  }

  const parsed = parseFenceMarkdown(text);
  for (const line of parsed.lines) {
    if (line.from === line.to) {
      continue;
    }

    const from = pos + 1 + line.from;
    const to = pos + 1 + line.to;
    if (line.kind === 'openingFence' || line.kind === 'closingFence') {
      decorations.push(
        Decoration.inline(from, to, {
          class: 'pm-md-delim pm-md-code-fence',
        }),
      );
      continue;
    }

    decorations.push(
      Decoration.inline(from, to, {
        class: 'pm-md-code-content',
      }),
    );
  }
}

export function buildMarkdownDecorationsForTextblock(
  node: PMNode,
  pos: number,
): Decoration[] {
  if (!node.isTextblock) {
    return [];
  }

  const decorations: Decoration[] = [];
  if (node.type.spec.code) {
    addFenceDecorations(node, pos, decorations);
  } else {
    addInlineDecorations(node, pos, decorations);
  }
  return decorations;
}

export function buildMarkdownDecorations(doc: PMNode): Decoration[] {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }

    decorations.push(...buildMarkdownDecorationsForTextblock(node, pos));
    return false;
  });

  return decorations;
}
