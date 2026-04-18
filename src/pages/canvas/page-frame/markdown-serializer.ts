/**
 * Tiny ProseMirror → Markdown serializer for the page-frame schema.
 * The schema is custom (flat bullet/ordered items with an `indent` attr,
 * mentions, etc.) so we can't lean on `prosemirror-markdown`'s default
 * serializer. This walks the doc node-by-node and emits CommonMark.
 */

import type { Mark, Node as PMNode } from 'prosemirror-model';

export function serializeDocToMarkdown(doc: PMNode): string {
  const parts: string[] = [];
  doc.forEach((child) => {
    const block = serializeBlock(child);
    if (block !== null) {
      parts.push(block);
    }
  });
  // Collapse runs of blank lines down to at most one, then trim trailing.
  return `${parts
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '')}\n`;
}

function serializeBlock(node: PMNode): string | null {
  switch (node.type.name) {
    case 'paragraph':
      return serializeInline(node);
    case 'heading': {
      const level = Math.max(1, Math.min(6, node.attrs.level as number));
      return `${'#'.repeat(level)} ${serializeInline(node)}`;
    }
    case 'bulletListItem': {
      const indent = Math.max(0, (node.attrs.indent as number) ?? 0);
      return `${'  '.repeat(indent)}- ${serializeInline(node)}`;
    }
    case 'orderedListItem': {
      const indent = Math.max(0, (node.attrs.indent as number) ?? 0);
      const order = (node.attrs.order as number) ?? 1;
      return `${'  '.repeat(indent)}${order}. ${serializeInline(node)}`;
    }
    case 'blockquote':
      return serializeInline(node)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'codeBlock': {
      const text = node.textContent;
      return `\`\`\`\n${text}\n\`\`\``;
    }
    case 'horizontalRule':
      return '---';
    default:
      return serializeInline(node);
  }
}

function serializeInline(node: PMNode): string {
  let out = '';
  const activeMarks: Mark[] = [];

  const closeMarks = (marks: readonly Mark[]) => {
    // Close marks in reverse order of opening.
    for (let i = activeMarks.length - 1; i >= 0; i--) {
      const m = activeMarks[i];
      if (!marks.some((n) => n.eq(m))) {
        out += markClose(m, textTail(out));
        activeMarks.splice(i, 1);
      }
    }
  };

  const openMarks = (marks: readonly Mark[]) => {
    for (const m of marks) {
      if (!activeMarks.some((a) => a.eq(m))) {
        out += markOpen(m);
        activeMarks.push(m);
      }
    }
  };

  node.forEach((child) => {
    if (child.isText) {
      closeMarks(child.marks);
      openMarks(child.marks);
      out += escapeMarkdown(child.text ?? '');
    } else {
      closeMarks([]);
      out += renderInlineAtom(child);
    }
  });

  closeMarks([]);
  return out;
}

function renderInlineAtom(node: PMNode): string {
  switch (node.type.name) {
    case 'image': {
      const alt = (node.attrs.alt as string | null) ?? '';
      const src = (node.attrs.src as string | null) ?? '';
      return `![${escapeMarkdown(alt)}](${src})`;
    }
    case 'mention': {
      const label = (node.attrs.label as string | null) ?? '';
      return `@${label}`;
    }
    default:
      return node.textContent;
  }
}

function markOpen(mark: Mark): string {
  switch (mark.type.name) {
    case 'bold':
      return '**';
    case 'italic':
      return '*';
    case 'underline':
      return '<u>';
    case 'strikethrough':
      return '~~';
    case 'code':
      return '`';
    case 'link':
      return '[';
    default:
      return '';
  }
}

function markClose(mark: Mark, _preceding: string): string {
  switch (mark.type.name) {
    case 'bold':
      return '**';
    case 'italic':
      return '*';
    case 'underline':
      return '</u>';
    case 'strikethrough':
      return '~~';
    case 'code':
      return '`';
    case 'link': {
      const href = (mark.attrs.href as string | null) ?? '';
      return `](${href})`;
    }
    default:
      return '';
  }
}

function textTail(s: string): string {
  return s.slice(-1);
}

function escapeMarkdown(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/([*_`[\]])/g, '\\$1');
}
