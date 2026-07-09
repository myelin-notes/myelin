/**
 * Tiny ProseMirror → Markdown serializer for the page-frame schema.
 * The schema is custom (flat bullet/ordered/checklist items with an
 * `indent` attr, mentions, etc.) so we can't lean on `prosemirror-markdown`'s
 * default serializer. This walks the doc node-by-node and emits CommonMark.
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

/**
 * Chunked variant — yields to the event loop every {@link BATCH_SIZE}
 * blocks so large documents don't freeze the UI while serializing. Use
 * this from interactive paths (export menu, etc.).
 */
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
      // The page-frame schema stores fence delimiters (```lang / ```) as
      // part of the code block's own text content — the editor renders
      // them as visual fences. Emit the text verbatim to avoid nesting.
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
 * Escapes the literal pipes in already-serialized cell content so they
 * don't split the row on re-parse. The input is the output of
 * {@link serializeInline}, which has already escaped markdown specials and
 * emitted `$...$` math verbatim — re-running {@link escapeMarkdown} here
 * would double LaTeX backslashes (`$e^{i\pi}$` → `$e^{i\\pi}$`) and grow
 * escapes across save cycles. Pipes are escaped everywhere (including inside
 * math) because the table parser unescapes `\|` back to a literal `|`.
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

/**
 * Escapes markdown like `escapeMarkdown`, but emits inline-math spans
 * (`$...$`) verbatim — LaTeX is full of backslashes that must not be
 * doubled (e.g. `$e^{i\pi}$`).
 */
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
