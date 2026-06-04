/**
 * Minimal Markdown → ProseMirror parser for the page-frame schema.
 *
 * The schema is bespoke (flat list items with indent attrs, custom
 * mentions) so we skip the standard `prosemirror-markdown` package and
 * hand-roll a focused parser. Supports: headings, paragraphs, bullet,
 * ordered, and checklist items (with indent), blockquote, callouts,
 * fenced code blocks, math blocks ($$ fences),
 * tables, hr,
 * and inline marks (bold, italic, strikethrough, code, link, image).
 */

import type { Mark, Node as PMNode, Schema } from 'prosemirror-model';
import { parseCalloutMarker } from './callouts';
import { OPENING_FENCE_TOKEN_RE } from './pm/markdown/parse-fences';
import { parseInlineMarkdown } from './pm/markdown/parse-inline';
import {
  isMathFenceLine,
  SINGLE_LINE_MATH_BLOCK_RE,
} from './pm/math/parse-math-block';

export function parseMarkdownToDoc(md: string, schema: Schema): PMNode {
  const blocks = parseBlocks(md.replace(/\r\n/g, '\n'));
  return buildDoc(blocks, schema);
}

interface BaseToken {
  content?: string;
  rows?: TableRowToken[];
  text?: string;
  level?: number;
  indent?: number;
  order?: number;
  checked?: boolean;
}
interface TableRowToken {
  cells: string[];
  isHeader: boolean;
}
type BlockToken = BaseToken &
  (
    | { type: 'heading' }
    | { type: 'paragraph' }
    | { type: 'bullet' }
    | { type: 'ordered' }
    | { type: 'check' }
    | { type: 'blockquote' }
    | { type: 'codeBlock' }
    | { type: 'mathBlock' }
    | { type: 'table' }
    | { type: 'hr' }
  );

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const CHECK_RE = /^(\s*)[-*+]\s+\[([ xX])\](?:\s+(.*))?$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)\.\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const FENCE_RE = /^```/;
const TABLE_DIVIDER_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const source = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\' && i + 1 < source.length) {
      // Only `\|` is a split-level escape; every other `\X` passes through
      // intact (as a unit, so `\\|` keeps the backslash and splits on the
      // pipe) for parseInline to handle — unescaping here would strip LaTeX
      // backslashes from cell math and double-unescape markdown escapes.
      const next = source[i + 1];
      current += next === '|' ? '|' : `\\${next}`;
      i += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function isTableRow(line: string): boolean {
  return line.includes('|') && splitTableRow(line).length >= 2;
}

function isTableDivider(line: string): boolean {
  return TABLE_DIVIDER_RE.test(line);
}

function parseTable(
  lines: string[],
  startIndex: number,
): { nextIndex: number; token: BlockToken } | null {
  if (
    startIndex + 1 >= lines.length ||
    !isTableRow(lines[startIndex]) ||
    !isTableDivider(lines[startIndex + 1])
  ) {
    return null;
  }

  const headerCells = splitTableRow(lines[startIndex]);
  const dividerCells = splitTableRow(lines[startIndex + 1]);
  const columnCount = Math.max(headerCells.length, dividerCells.length);
  const rows: TableRowToken[] = [
    {
      isHeader: true,
      cells: headerCells,
    },
  ];

  let index = startIndex + 2;
  while (index < lines.length && isTableRow(lines[index])) {
    rows.push({
      isHeader: false,
      cells: splitTableRow(lines[index]),
    });
    index += 1;
  }

  for (const row of rows) {
    while (row.cells.length < columnCount) {
      row.cells.push('');
    }
  }

  return {
    nextIndex: index,
    token: {
      type: 'table',
      rows,
    },
  };
}

function parseBlocks(md: string): BlockToken[] {
  const lines = md.split('\n');
  const out: BlockToken[] = [];
  let i = 0;

  const isBlockStart = (line: string, index: number): boolean => {
    const t = line.trim();
    return (
      FENCE_RE.test(t) ||
      isMathFenceLine(t) ||
      SINGLE_LINE_MATH_BLOCK_RE.test(t) ||
      HR_RE.test(t) ||
      HEADING_RE.test(line) ||
      CHECK_RE.test(line) ||
      BULLET_RE.test(line) ||
      ORDERED_RE.test(line) ||
      QUOTE_RE.test(line) ||
      isTableDivider(line) ||
      parseTable(lines, index) !== null
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      i++;
      continue;
    }

    if (FENCE_RE.test(trimmed)) {
      // The page-frame's codeBlock stores fence delimiters as part of its
      // text content (see fenceMarkdownNormalizationPlugin). The opening
      // fence must satisfy isOpeningFenceLine (``` + optional info token)
      // and the closing must be exactly "```" — otherwise the plugin
      // unwraps the block back to paragraphs.
      const langMatch = trimmed.match(OPENING_FENCE_TOKEN_RE);
      const openFence = langMatch?.[1] ? `\`\`\`${langMatch[1]}` : '```';
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !FENCE_RE.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        i++; // consume closing fence
      }
      const text = [openFence, ...codeLines, '```'].join('\n');
      out.push({ type: 'codeBlock', text });
      continue;
    }

    if (isMathFenceLine(trimmed)) {
      // Like codeBlock, mathBlock stores its `$$` fence lines as part of its
      // text content (see mathBlockNormalizationPlugin). A missing closing
      // fence consumes to the end and is closed, mirroring code fences.
      i++;
      const mathLines: string[] = [];
      while (i < lines.length && !isMathFenceLine(lines[i].trim())) {
        mathLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        i++; // consume closing fence
      }
      out.push({
        type: 'mathBlock',
        text: ['$$', ...mathLines, '$$'].join('\n'),
      });
      continue;
    }

    const singleLineMath = trimmed.match(SINGLE_LINE_MATH_BLOCK_RE);
    if (singleLineMath) {
      // Canonicalize `$$x$$` into the multi-line form so math blocks keep a
      // single invariant: first line `$$`, a later line `$$`.
      out.push({
        type: 'mathBlock',
        text: ['$$', singleLineMath[1], '$$'].join('\n'),
      });
      i++;
      continue;
    }

    const table = parseTable(lines, i);
    if (table) {
      out.push(table.token);
      i = table.nextIndex;
      continue;
    }

    if (HR_RE.test(trimmed)) {
      out.push({ type: 'hr' });
      i++;
      continue;
    }

    const h = line.match(HEADING_RE);
    if (h) {
      out.push({
        type: 'heading',
        level: Math.min(3, h[1].length),
        content: h[2],
      });
      i++;
      continue;
    }

    const c = line.match(CHECK_RE);
    if (c) {
      out.push({
        type: 'check',
        indent: Math.min(4, Math.floor(c[1].length / 2)),
        content: c[3] ?? '',
        checked: c[2].toLowerCase() === 'x',
      });
      i++;
      continue;
    }

    const b = line.match(BULLET_RE);
    if (b) {
      out.push({
        type: 'bullet',
        indent: Math.min(4, Math.floor(b[1].length / 2)),
        content: b[2],
      });
      i++;
      continue;
    }

    const o = line.match(ORDERED_RE);
    if (o) {
      out.push({
        type: 'ordered',
        indent: Math.min(4, Math.floor(o[1].length / 2)),
        order: Number(o[2]),
        content: o[3],
      });
      i++;
      continue;
    }

    const q = line.match(QUOTE_RE);
    if (q) {
      const parts = [q[1]];
      i++;
      while (i < lines.length) {
        const m = lines[i].match(QUOTE_RE);
        if (!m) {
          break;
        }
        parts.push(m[1]);
        i++;
      }
      out.push({
        type: 'blockquote',
        content: parseCalloutMarker(parts[0])
          ? parts.join('\n')
          : parts.join(' '),
      });
      continue;
    }

    // Paragraph: consume consecutive non-blank lines that don't start a block.
    const paraLines = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === '' || isBlockStart(next, i)) {
        break;
      }
      paraLines.push(next);
      i++;
    }
    out.push({ type: 'paragraph', content: paraLines.join(' ') });
  }

  return out;
}

// -- Inline parser -------------------------------------------------------

function parseInline(text: string, schema: Schema): PMNode[] {
  return scanInline(text, schema, []);
}

function isExactDelimiterRun(
  text: string,
  index: number,
  delimiter: string,
): boolean {
  if (!text.startsWith(delimiter, index)) {
    return false;
  }

  const char = delimiter[0];
  const before = index > 0 ? text[index - 1] : '';
  const after = text[index + delimiter.length] ?? '';
  return before !== char && after !== char;
}

function findClosingDelimiterRun(
  text: string,
  from: number,
  delimiter: string,
): number {
  for (let i = from; i <= text.length - delimiter.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (isExactDelimiterRun(text, i, delimiter)) {
      return i;
    }
  }
  return -1;
}

function scanInline(
  text: string,
  schema: Schema,
  baseMarks: readonly Mark[],
): PMNode[] {
  const nodes: PMNode[] = [];
  let buf = '';
  let i = 0;

  // Inline-math spans are derived from the shared inline parser so the
  // importer, the live-preview decorations, and the serializer all agree on
  // which `$...$` runs are math. This inherits parse-inline's precedence
  // rules (inline code / note links win via its `blocked` array) and its
  // `\$` escape handling, avoiding a parallel scanner that could disagree.
  const mathEndByStart = new Map<number, number>();
  for (const range of parseInlineMarkdown(text).ranges) {
    if (range.kind === 'math') {
      mathEndByStart.set(range.open.from, range.close.to);
    }
  }

  const pushText = () => {
    if (buf.length > 0) {
      nodes.push(schema.text(buf, baseMarks.slice()));
      buf = '';
    }
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === '\\' && i + 1 < text.length) {
      // Keep the backslash before a `$` so the live-preview parser
      // (parse-inline's `isEscaped`) still treats it as an escaped, non-math
      // dollar. Stripping it would turn `\$a\$` into `$a$`, which reloads as
      // live math — the opposite of what the escape requested.
      buf += text[i + 1] === '$' ? `\\$` : text[i + 1];
      i += 2;
      continue;
    }

    if (ch === '\n' && schema.nodes.hardBreak) {
      pushText();
      nodes.push(schema.nodes.hardBreak.create());
      i++;
      continue;
    }

    // Embed syntax (`![alt](url)`) stays as literal text — a decoration
    // plugin renders the preview beneath the source.
    if (ch === '!' && text[i + 1] === '[') {
      const m = text
        .slice(i)
        .match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
      if (m) {
        buf += m[0];
        i += m[0].length;
        continue;
      }
    }

    // Link: [text](url)
    if (ch === '[') {
      const m = text
        .slice(i)
        .match(/^\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
      if (m) {
        pushText();
        const linkMark = schema.marks.link.create({
          href: m[2],
          title: m[3] ?? null,
        });
        for (const child of scanInline(m[1], schema, [
          ...baseMarks,
          linkMark,
        ])) {
          nodes.push(child);
        }
        i += m[0].length;
        continue;
      }
    }

    // Inline code: `...`
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        pushText();
        const codeText = text.slice(i + 1, end);
        if (codeText.length > 0) {
          nodes.push(
            schema.text(codeText, [...baseMarks, schema.marks.code.create()]),
          );
        }
        i = end + 1;
        continue;
      }
    }

    // Inline math: $...$ stays literal text, backslashes intact — the math
    // preview plugin renders it. The span boundaries come from the shared
    // inline parser (see mathEndByStart) so importer and preview agree.
    if (ch === '$') {
      const end = mathEndByStart.get(i);
      if (end !== undefined) {
        buf += text.slice(i, end);
        i = end;
        continue;
      }
    }

    // Bold + italic: ***...***
    if (
      ch === '*' &&
      text[i + 1] === '*' &&
      text[i + 2] === '*' &&
      isExactDelimiterRun(text, i, '***')
    ) {
      const end = findClosingDelimiterRun(text, i + 3, '***');
      if (end !== -1) {
        pushText();
        const inner = text.slice(i + 3, end);
        for (const child of scanInline(inner, schema, [
          ...baseMarks,
          schema.marks.bold.create(),
          schema.marks.italic.create(),
        ])) {
          nodes.push(child);
        }
        i = end + 3;
        continue;
      }
    }

    // Bold: **...** or __...__
    if (
      (ch === '*' && text[i + 1] === '*') ||
      (ch === '_' && text[i + 1] === '_')
    ) {
      const delim = text.slice(i, i + 2);
      const end = text.indexOf(delim, i + 2);
      if (end !== -1) {
        pushText();
        const inner = text.slice(i + 2, end);
        for (const child of scanInline(inner, schema, [
          ...baseMarks,
          schema.marks.bold.create(),
        ])) {
          nodes.push(child);
        }
        i = end + 2;
        continue;
      }
    }

    // Italic: *...* or _..._
    if (ch === '*' || ch === '_') {
      // Match up to the next unescaped delimiter of the same kind that
      // isn't part of a bold (**) pair.
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === ch && text[j + 1] !== ch && text[j - 1] !== ch) {
          break;
        }
        j++;
      }
      if (j < text.length && j > i + 1) {
        pushText();
        const inner = text.slice(i + 1, j);
        for (const child of scanInline(inner, schema, [
          ...baseMarks,
          schema.marks.italic.create(),
        ])) {
          nodes.push(child);
        }
        i = j + 1;
        continue;
      }
    }

    // Strikethrough: ~~...~~
    if (ch === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2);
      if (end !== -1) {
        pushText();
        const inner = text.slice(i + 2, end);
        for (const child of scanInline(inner, schema, [
          ...baseMarks,
          schema.marks.strikethrough.create(),
        ])) {
          nodes.push(child);
        }
        i = end + 2;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  pushText();
  return nodes;
}

// -- Assembly ------------------------------------------------------------

function buildDoc(blocks: BlockToken[], schema: Schema): PMNode {
  const nodes: PMNode[] = [];
  for (const block of blocks) {
    const node = blockToNode(block, schema);
    if (node) {
      nodes.push(node);
    }
  }
  if (nodes.length === 0) {
    nodes.push(schema.nodes.paragraph.create());
  }
  return schema.nodes.doc.create(null, nodes);
}

function blockToNode(block: BlockToken, schema: Schema): PMNode | null {
  switch (block.type) {
    case 'heading':
      return schema.nodes.heading.create(
        { level: block.level ?? 1 },
        parseInline(block.content ?? '', schema),
      );
    case 'paragraph':
      return schema.nodes.paragraph.create(
        null,
        parseInline(block.content ?? '', schema),
      );
    case 'bullet':
      return schema.nodes.bulletListItem.create(
        { indent: block.indent ?? 0 },
        parseInline(block.content ?? '', schema),
      );
    case 'check':
      return schema.nodes.checkListItem.create(
        { checked: block.checked ?? false, indent: block.indent ?? 0 },
        parseInline(block.content ?? '', schema),
      );
    case 'ordered':
      return schema.nodes.orderedListItem.create(
        { indent: block.indent ?? 0, order: block.order ?? 1 },
        parseInline(block.content ?? '', schema),
      );
    case 'blockquote':
      return schema.nodes.blockquote.create(
        null,
        parseInline(block.content ?? '', schema),
      );
    case 'codeBlock': {
      const text = block.text ?? '';
      return schema.nodes.codeBlock.create(
        null,
        text.length > 0 ? [schema.text(text)] : [],
      );
    }
    case 'mathBlock': {
      const text = block.text ?? '';
      return schema.nodes.mathBlock.create(
        null,
        text.length > 0 ? [schema.text(text)] : [],
      );
    }
    case 'table': {
      const tableRows = block.rows ?? [];
      if (tableRows.length === 0) {
        return null;
      }

      return schema.nodes.table.create(
        null,
        tableRows.map((row) =>
          schema.nodes.table_row.create(
            null,
            row.cells.map((cell) =>
              (row.isHeader
                ? schema.nodes.table_header
                : schema.nodes.table_cell
              ).create(
                null,
                schema.nodes.paragraph.create(null, parseInline(cell, schema)),
              ),
            ),
          ),
        ),
      );
    }
    case 'hr':
      return schema.nodes.horizontalRule.create();
    default:
      return null;
  }
}
