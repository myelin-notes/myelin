import { Mark, type Node as ProseMirrorNode } from 'prosemirror-model';
import type { CanvasPalette } from '../../canvas-theme';

// Approximate visual metrics. They don't need to match the live editor — the result is shown at
// <=600px, so coarse line heights and greedy word-wrap read fine.
// Chrome colors are refreshed from the canvas palette at render entry so the thumbnail tracks
// light/dark; the fallbacks are the original light values.
let TEXT_COLOR = '#1f2933';
let MUTED_COLOR = '#7b8794';
let SHADE_COLOR = '#f0f2f5';
let RULE_COLOR = '#cbd2d9';
const BODY_FONT = 'sans-serif';
const MONO_FONT = 'monospace';

const BODY_SIZE = 16;
const BODY_LINE_HEIGHT = 24;
const BLOCK_GAP = 12;
const PARAGRAPH_GAP = 8;
const LIST_INDENT = 22;
const BULLET_GAP = 18;

interface HeadingStyle {
  size: number;
  lineHeight: number;
}

const HEADING_STYLES: Record<number, HeadingStyle> = {
  1: { size: 30, lineHeight: 40 },
  2: { size: 24, lineHeight: 32 },
  3: { size: 20, lineHeight: 28 },
};

export interface RenderPageFrameThumbnailOptions {
  /** Content width available for text, in element-local px (page width minus padding). */
  width: number;
  /** Stop drawing once the y-cursor passes this height. Bounds work on huge docs. */
  maxHeight: number;
}

interface Cursor {
  y: number;
}

/**
 * Pure: reads the doc model and emits draw calls into `ctx`. No DOM access — theme colors come from
 * the `palette` the caller passes in. The caller must translate `ctx` so (0, 0) is the top-left of
 * the content area, and draw any page background first.
 */
export function renderPageFrameThumbnail(
  doc: ProseMirrorNode,
  ctx: CanvasRenderingContext2D,
  opts: RenderPageFrameThumbnailOptions,
  palette: CanvasPalette,
): void {
  const { width, maxHeight } = opts;
  const cursor: Cursor = { y: 0 };

  TEXT_COLOR = palette.textPrimary;
  MUTED_COLOR = palette.textMuted;
  SHADE_COLOR = palette.muted;
  RULE_COLOR = palette.border;

  ctx.textBaseline = 'top';

  doc.forEach((block) => {
    if (cursor.y >= maxHeight) {
      return;
    }
    drawBlock(block, ctx, cursor, width);
    cursor.y += BLOCK_GAP;
  });
}

function drawBlock(
  block: ProseMirrorNode,
  ctx: CanvasRenderingContext2D,
  cursor: Cursor,
  width: number,
): void {
  const type = block.type.name;

  switch (type) {
    case 'heading': {
      const level = (block.attrs.level as number) || 1;
      const style = HEADING_STYLES[level] ?? HEADING_STYLES[3];
      drawText(ctx, cursor, inlinePieces(block), {
        width,
        x: 0,
        size: style.size,
        bold: true,
        color: TEXT_COLOR,
        lineHeight: style.lineHeight,
      });
      return;
    }
    case 'paragraph':
    case 'blockquote': {
      const indent = type === 'blockquote' ? BULLET_GAP : 0;
      if (type === 'blockquote') {
        drawBlockquoteBar(ctx, cursor, block, width);
      }
      drawParagraphText(ctx, cursor, block, width - indent, indent);
      return;
    }
    case 'bulletListItem':
    case 'orderedListItem':
    case 'checkListItem': {
      drawListItem(ctx, cursor, block, width);
      return;
    }
    case 'codeBlock':
    case 'mathBlock': {
      drawCodeBlock(ctx, cursor, block, width);
      return;
    }
    case 'horizontalRule': {
      drawRule(ctx, cursor, width);
      return;
    }
    case 'table': {
      drawPlaceholderRect(ctx, cursor, width, tableHeight(block));
      return;
    }
    case 'pageBreak':
      return;
    case 'figure': {
      const aspect = block.attrs.aspect as number | null;
      const figureWidth = width * (block.attrs.width as number);
      drawPlaceholderRect(
        ctx,
        cursor,
        figureWidth,
        aspect ? figureWidth / aspect : BODY_LINE_HEIGHT * 6,
      );
      return;
    }
    default: {
      // Unknown block: render its text if any, otherwise a thin placeholder.
      if (block.textContent) {
        drawParagraphText(ctx, cursor, block, width, 0);
      } else {
        drawPlaceholderRect(ctx, cursor, width, BODY_LINE_HEIGHT * 3);
      }
      return;
    }
  }
}

function drawParagraphText(
  ctx: CanvasRenderingContext2D,
  cursor: Cursor,
  block: ProseMirrorNode,
  width: number,
  x: number,
): void {
  if (!block.textContent.trim()) {
    // Empty paragraph still occupies a line of vertical space.
    cursor.y += BODY_LINE_HEIGHT;
    return;
  }
  drawText(ctx, cursor, inlinePieces(block), {
    width,
    x,
    size: BODY_SIZE,
    bold: false,
    color: TEXT_COLOR,
    lineHeight: BODY_LINE_HEIGHT,
  });
}

function drawListItem(
  ctx: CanvasRenderingContext2D,
  cursor: Cursor,
  block: ProseMirrorNode,
  width: number,
): void {
  const indentLevel = (block.attrs.indent as number) || 0;
  const baseX = indentLevel * LIST_INDENT;
  const markerY = cursor.y;

  ctx.fillStyle = MUTED_COLOR;
  ctx.font = `${BODY_SIZE}px ${BODY_FONT}`;
  ctx.textBaseline = 'top';

  const type = block.type.name;
  let marker: string;
  if (type === 'orderedListItem') {
    marker = `${(block.attrs.order as number) || 1}.`;
  } else if (type === 'checkListItem') {
    marker = block.attrs.checked === true ? '☑' : '☐';
  } else {
    marker = '•';
  }
  ctx.fillText(marker, baseX, markerY);

  const textX = baseX + BULLET_GAP;
  drawText(ctx, cursor, inlinePieces(block), {
    width: width - textX,
    x: textX,
    size: BODY_SIZE,
    bold: false,
    color: TEXT_COLOR,
    lineHeight: BODY_LINE_HEIGHT,
  });
}

function drawBlockquoteBar(
  ctx: CanvasRenderingContext2D,
  cursor: Cursor,
  block: ProseMirrorNode,
  width: number,
): void {
  const lines = estimateLineCount(ctx, block.textContent, width - BULLET_GAP, {
    font: `${BODY_SIZE}px ${BODY_FONT}`,
  });
  const height = Math.max(BODY_LINE_HEIGHT, lines * BODY_LINE_HEIGHT);
  ctx.fillStyle = RULE_COLOR;
  ctx.fillRect(0, cursor.y, 3, height);
}

function drawCodeBlock(
  ctx: CanvasRenderingContext2D,
  cursor: Cursor,
  block: ProseMirrorNode,
  width: number,
): void {
  const text = block.textContent;
  const rawLines = text.length > 0 ? text.split('\n') : [''];
  const padding = 8;
  const lineHeight = BODY_LINE_HEIGHT - 4;
  const height = rawLines.length * lineHeight + padding * 2;
  const top = cursor.y;

  ctx.fillStyle = SHADE_COLOR;
  ctx.fillRect(0, top, width, height);

  ctx.fillStyle = MUTED_COLOR;
  ctx.font = `13px ${MONO_FONT}`;
  ctx.textBaseline = 'top';
  let lineY = top + padding;
  for (const line of rawLines) {
    ctx.fillText(
      truncateToWidth(ctx, line, width - padding * 2),
      padding,
      lineY,
    );
    lineY += lineHeight;
  }

  cursor.y = top + height;
}

function drawRule(
  ctx: CanvasRenderingContext2D,
  cursor: Cursor,
  width: number,
): void {
  const y = cursor.y + BODY_LINE_HEIGHT / 2;
  ctx.strokeStyle = RULE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
  cursor.y += BODY_LINE_HEIGHT;
}

function drawPlaceholderRect(
  ctx: CanvasRenderingContext2D,
  cursor: Cursor,
  width: number,
  height: number,
): void {
  ctx.fillStyle = SHADE_COLOR;
  ctx.fillRect(0, cursor.y, width, height);
  cursor.y += height;
}

function tableHeight(block: ProseMirrorNode): number {
  const rows = block.childCount;
  return Math.max(1, rows) * BODY_LINE_HEIGHT;
}

interface DrawTextOptions {
  width: number;
  x: number;
  size: number;
  bold: boolean;
  color: string;
  lineHeight: number;
}

interface Piece {
  text: string;
  marks: readonly Mark[];
}

function inlinePieces(block: ProseMirrorNode): Piece[] {
  const pieces: Piece[] = [];
  block.forEach((child) => {
    pieces.push({
      text: child.isText ? (child.text ?? '') : child.textContent,
      marks: child.marks,
    });
  });
  return pieces;
}

function hasMark(piece: Piece, name: string): boolean {
  return piece.marks.some((mark) => mark.type.name === name);
}

function pieceFont(piece: Piece, opts: DrawTextOptions): string {
  const italic = hasMark(piece, 'italic') ? 'italic ' : '';
  const bold = opts.bold || hasMark(piece, 'bold') ? 'bold ' : '';
  const family = hasMark(piece, 'code') ? MONO_FONT : BODY_FONT;
  return `${italic}${bold}${opts.size}px ${family}`;
}

function measurePiece(
  ctx: CanvasRenderingContext2D,
  piece: Piece,
  opts: DrawTextOptions,
): number {
  ctx.font = pieceFont(piece, opts);
  return ctx.measureText(piece.text).width;
}

// Greedy word wrap over marked runs; a word may span runs (`**bo**ld`), so wrapping only breaks at
// whitespace and adjacent same-mark runs are merged back into one fillText per line.
function wrapPieces(
  ctx: CanvasRenderingContext2D,
  pieces: readonly Piece[],
  opts: DrawTextOptions,
): Piece[][] {
  const words: Piece[][] = [];
  let word: Piece[] = [];
  for (const piece of pieces) {
    for (const part of piece.text.split(/(\s+)/)) {
      if (/^\s/.test(part) && word.length > 0) {
        words.push(word);
        word = [];
      } else if (part && !/^\s/.test(part)) {
        word.push({ text: part, marks: piece.marks });
      }
    }
  }
  if (word.length > 0) {
    words.push(word);
  }

  const lines: Piece[][] = [];
  let line: Piece[] = [];
  let lineWidth = 0;
  for (const next of words) {
    const wordWidth = next.reduce((w, p) => w + measurePiece(ctx, p, opts), 0);
    const prev = line[line.length - 1];
    const sameMarks =
      prev !== undefined && Mark.sameSet(prev.marks, next[0].marks);
    const space: Piece = { text: ' ', marks: sameMarks ? prev.marks : [] };
    const spaceWidth = prev ? measurePiece(ctx, space, opts) : 0;
    if (prev && lineWidth + spaceWidth + wordWidth > opts.width) {
      lines.push(line);
      line = [...next];
      lineWidth = wordWidth;
      continue;
    }
    line.push(...(prev ? [space] : []), ...next);
    lineWidth += spaceWidth + wordWidth;
  }
  if (line.length > 0) {
    lines.push(line);
  }

  return lines.map((pieces) =>
    pieces.reduce<Piece[]>((merged, piece) => {
      const last = merged[merged.length - 1];
      if (last && Mark.sameSet(last.marks, piece.marks)) {
        merged[merged.length - 1] = { ...last, text: last.text + piece.text };
      } else {
        merged.push(piece);
      }
      return merged;
    }, []),
  );
}

function drawText(
  ctx: CanvasRenderingContext2D,
  cursor: Cursor,
  pieces: readonly Piece[],
  opts: DrawTextOptions,
): void {
  ctx.textBaseline = 'top';

  for (const line of wrapPieces(ctx, pieces, opts)) {
    let x = opts.x;
    for (const piece of line) {
      const w = measurePiece(ctx, piece, opts);
      if (hasMark(piece, 'code')) {
        ctx.fillStyle = SHADE_COLOR;
        ctx.fillRect(x, cursor.y - 2, w, opts.size + 4);
      }
      ctx.fillStyle = opts.color;
      ctx.fillText(piece.text, x, cursor.y);
      if (hasMark(piece, 'underline')) {
        ctx.fillRect(x, cursor.y + opts.size, w, 1);
      }
      if (hasMark(piece, 'strikethrough')) {
        ctx.fillRect(x, cursor.y + opts.size * 0.55, w, 1);
      }
      x += w;
    }
    cursor.y += opts.lineHeight;
  }
  cursor.y += PARAGRAPH_GAP;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function estimateLineCount(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  opts: { font: string },
): number {
  ctx.font = opts.font;
  return Math.max(1, wrapText(ctx, text, width).length);
}

function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): string {
  if (ctx.measureText(text).width <= width) {
    return text;
  }
  let truncated = text;
  while (
    truncated.length > 0 &&
    ctx.measureText(`${truncated}…`).width > width
  ) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}
