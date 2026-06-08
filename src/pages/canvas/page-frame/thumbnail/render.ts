import type { Node as ProseMirrorNode } from 'prosemirror-model';

/**
 * Approximate visual metrics for the thumbnail. These don't need to match the
 * live editor exactly — the result is shown at <=600px, so coarse line heights
 * and greedy word-wrap read fine.
 */
const TEXT_COLOR = '#1f2933';
const MUTED_COLOR = '#7b8794';
const SHADE_COLOR = '#f0f2f5';
const RULE_COLOR = '#cbd2d9';
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
 * Render an approximate visual of a ProseMirror document into a 2D context.
 *
 * Pure: reads the doc model and emits draw calls into `ctx`. No DOM access.
 * The caller is responsible for translating `ctx` so (0, 0) is the top-left of
 * the content area and for drawing any page background first.
 */
export function renderPageFrameThumbnail(
  doc: ProseMirrorNode,
  ctx: CanvasRenderingContext2D,
  opts: RenderPageFrameThumbnailOptions,
): void {
  const { width, maxHeight } = opts;
  const cursor: Cursor = { y: 0 };

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
      drawText(ctx, cursor, block.textContent, {
        width,
        x: 0,
        font: `bold ${style.size}px ${BODY_FONT}`,
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
      drawParagraphText(ctx, cursor, block.textContent, width - indent, indent);
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
    default: {
      // Unknown block: render its text if any, otherwise a thin placeholder.
      const text = block.textContent;
      if (text) {
        drawParagraphText(ctx, cursor, text, width, 0);
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
  text: string,
  width: number,
  x: number,
): void {
  if (!text.trim()) {
    // Empty paragraph still occupies a line of vertical space.
    cursor.y += BODY_LINE_HEIGHT;
    return;
  }
  drawText(ctx, cursor, text, {
    width,
    x,
    font: `${BODY_SIZE}px ${BODY_FONT}`,
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
  drawText(ctx, cursor, block.textContent, {
    width: width - textX,
    x: textX,
    font: `${BODY_SIZE}px ${BODY_FONT}`,
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
  font: string;
  color: string;
  lineHeight: number;
}

/**
 * Greedy word-wrap `text` to `width` and paint each line, advancing the cursor.
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  cursor: Cursor,
  text: string,
  opts: DrawTextOptions,
): void {
  ctx.font = opts.font;
  ctx.fillStyle = opts.color;
  ctx.textBaseline = 'top';

  const lines = wrapText(ctx, text, opts.width);
  for (const line of lines) {
    ctx.fillText(line, opts.x, cursor.y);
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
