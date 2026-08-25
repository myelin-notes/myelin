/**
 * ProseMirror → Markdown for the page-frame schema. The schema is custom (flat bullet/ordered/
 * checklist items with an `indent` attr, mentions), so `prosemirror-markdown`'s default serializer
 * doesn't apply.
 */

import type { Mark, Node as PMNode } from 'prosemirror-model';
import { parseCalloutMarker } from '../callouts';
import { parseInlineMarkdown } from '../pm/markdown/parse-inline';

export function serializeDocToMarkdown(doc: PMNode): string {
  const parts: string[] = [];
  doc.forEach((child) => {
    const block = serializeBlock(child);
    if (block !== null) {
      parts.push(block);
    }
  });
  return finalize(parts);
}

// Yields to the event loop every {@link BATCH_SIZE} blocks. Use from interactive paths.
export async function serializeDocToMarkdownChunked(
  doc: PMNode,
): Promise<string> {
  const children: PMNode[] = [];
  doc.forEach((c) => {
    children.push(c);
  });

  const parts: string[] = [];
  for (let i = 0; i < children.length; i++) {
    const block = serializeBlock(children[i]);
    if (block !== null) {
      parts.push(block);
    }
    if ((i + 1) % BATCH_SIZE === 0 && i + 1 < children.length) {
      await yieldToEventLoop();
    }
  }
  return finalize(parts);
}

const BATCH_SIZE = 64;

function finalize(parts: string[]): string {
  // Collapse runs of blank lines down to at most one, then trim trailing.
  return `${parts
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '')}\n`;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    // `requestIdleCallback` is available in most Chromium/WebKit webviews
    // and yields until the browser has idle time; fall back to a macrotask.
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 16 });
    } else {
      setTimeout(resolve, 0);
    }
  });
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
    case 'checkListItem': {
      const indent = Math.max(0, (node.attrs.indent as number) ?? 0);
      const marker = node.attrs.checked === true ? 'x' : ' ';
      const content = serializeInline(node);
      return `${'  '.repeat(indent)}- [${marker}]${content ? ` ${content}` : ''}`;
    }
    case 'orderedListItem': {
      const indent = Math.max(0, (node.attrs.indent as number) ?? 0);
      const order = (node.attrs.order as number) ?? 1;
      return `${'  '.repeat(indent)}${order}. ${serializeInline(node)}`;
    }
    case 'blockquote':
      return serializeBlockquote(node);
    case 'codeBlock':
      // The schema stores fence delimiters (```lang / ```) as part of the code block's own text
      // content, so emit it verbatim to avoid nesting.
      return node.textContent;
    case 'mathBlock':
      // Math blocks store their $$ fence lines as text, like codeBlock.
      return node.textContent;
    case 'table':
      return serializeTable(node);
    case 'horizontalRule':
      return '---';
    default:
      return serializeInline(node);
  }
}

function serializeBlockquote(node: PMNode): string {
  const lines = serializeInline(node).split('\n');
  if (parseCalloutMarker(node.textContent)) {
    lines[0] = lines[0].replace(
      /^\\\[!([A-Za-z][A-Za-z0-9_-]*)\\\]([+-]?)/,
      '[!$1]$2',
    );
  }

  return lines.map((line) => `> ${line.replace(/[ \t]+$/, '')}`).join('\n');
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
      out += child.marks.some((mark) => mark.type.name === 'noteLink')
        ? (child.text ?? '')
        : escapeMarkdownPreservingMath(child.text ?? '');
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
    case 'mention': {
      const label = (node.attrs.label as string | null) ?? '';
      return `@${label}`;
    }
    case 'hardBreak':
      return '\n';
    default:
      return node.textContent;
  }
}

function serializeTable(table: PMNode): string {
  const rows = table.content.content;
  if (rows.length === 0) {
    return '';
  }

  const headerRow = rows[0];
  const headerCells = serializeTableRow(headerRow);
  const divider = headerCells.map(() => '---');
  const bodyRows = rows.slice(1).map(serializeTableRow);

  return [
    renderTableRow(headerCells),
    renderTableRow(divider),
    ...bodyRows.map(renderTableRow),
  ].join('\n');
}

function serializeTableRow(row: PMNode): string[] {
  const cells: string[] = [];
  row.forEach((cell) => {
    cells.push(serializeTableCell(cell));
  });
  return cells;
}

function serializeTableCell(cell: PMNode): string {
  const parts: string[] = [];

  cell.forEach((block) => {
    if (block.type.name === 'paragraph') {
      parts.push(serializeInline(block));
      return;
    }

    if (block.isTextblock) {
      parts.push(serializeInline(block));
      return;
    }

    if (block.type.name === 'horizontalRule') {
      parts.push('---');
      return;
    }

    parts.push(block.textContent);
  });

  return escapeTableCellPipes(parts.join('<br>'));
}

/**
 * The input is already {@link serializeInline} output, which escaped markdown specials and emitted
 * `$...$` math verbatim — re-running {@link escapeMarkdown} would double LaTeX backslashes and grow
 * escapes across save cycles. Pipes are escaped even inside math, since the table parser unescapes
 * `\|` back to a literal `|`.
 */
function escapeTableCellPipes(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function renderTableRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
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
  return text.replace(/\\/g, '\\\\').replace(/([*_`[\]~])/g, '\\$1');
}

// Inline-math spans are emitted verbatim — LaTeX backslashes must not be doubled.
function escapeMarkdownPreservingMath(text: string): string {
  if (!text.includes('$')) {
    return escapeMarkdown(text);
  }

  const mathRanges = parseInlineMarkdown(text).ranges.filter(
    (range) => range.kind === 'math',
  );
  if (mathRanges.length === 0) {
    return escapeMarkdown(text);
  }

  let out = '';
  let last = 0;
  for (const range of mathRanges) {
    out += escapeMarkdown(text.slice(last, range.open.from));
    out += text.slice(range.open.from, range.close.to);
    last = range.close.to;
  }
  return out + escapeMarkdown(text.slice(last));
}
