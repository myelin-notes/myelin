export const PAGE_HEIGHT = 880;
export const PAGE_PADDING = 48;
export const PAGE_GAP = 40;
export const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_PADDING * 2; // 784
export const PAGE_BREAK_GAP = PAGE_PADDING + PAGE_GAP + PAGE_PADDING; // 136

export type BreakKind = 'block' | 'inline';

export interface Break {
  pos: number;
  spacer: number;
  kind: BreakKind;
}

export interface ParagraphPaginationResult {
  breaks: Break[];
  cumulativeShift: number;
  pageStart: number;
  pageBoundary: number;
  pageAdvances: number;
}

/**
 * One visual line inside a paragraph, in CSS pixels relative to the editor
 * content top, as if no pagination decorations existed. `getPos` is lazy —
 * it's only called when the pagination loop actually decides to emit a
 * break at this line, so measurers can defer any expensive DOM lookups until
 * they're actually needed.
 */
export interface ParagraphLine {
  naturalTop: number;
  naturalBottom: number;
  getPos: () => number | null;
}

export interface PaginationBlock {
  pos: number;
  measuredTop: number;
  height: number;
  nodeSize: number;
  isParagraph: boolean;
}

export interface ParagraphMeasurementState {
  blockNaturalTop: number;
  blockShift: number;
  cumulativeShift: number;
  pageBoundary: number;
  pageStart: number;
}

interface CalculateBreakLayoutOptions<Block extends PaginationBlock> {
  blocks: readonly Block[];
  existingBreaks: readonly Break[];
  measureParagraphLines: (
    block: Block,
    state: ParagraphMeasurementState,
  ) => ParagraphLine[];
  now?: () => number;
  onOverflowingBlock?: (block: Block) => void;
  onOverflowingParagraph?: (block: Block) => void;
  onParagraphMeasured?: (block: Block, lines: readonly ParagraphLine[]) => void;
  onParagraphPaginated?: (
    block: Block,
    result: ParagraphPaginationResult,
    elapsedMs: number,
  ) => void;
}

/**
 * Walk a paragraph's line list and emit page breaks.
 *
 * This is the *only* pagination algorithm for paragraphs. It doesn't know
 * or care how the lines were measured — Pretext or DOM — it just walks
 * them in order, checks whether each one crosses the current page boundary
 * in effective coordinates (natural + accumulated shift), and emits a
 * widget break when one does.
 */
export function paginateParagraph(
  lines: ParagraphLine[],
  blockPos: number,
  blockEnd: number,
  initialPageStart: number,
  initialPageBoundary: number,
  initialCumulativeShift: number,
): ParagraphPaginationResult {
  const breaks: Break[] = [];
  let pageStart = initialPageStart;
  let pageBoundary = initialPageBoundary;
  let cumulativeShift = initialCumulativeShift;
  let pageAdvances = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineEffectiveTop = line.naturalTop + cumulativeShift;
    const lineEffectiveBottom = line.naturalBottom + cumulativeShift;

    if (lineEffectiveBottom <= pageBoundary) {
      continue;
    }

    // Crosses the boundary. Emit a break unless the line is already at
    // the top of the current page (oversized/first-line case).
    if (lineEffectiveTop > pageStart) {
      const spacer = pageBoundary + PAGE_BREAK_GAP - lineEffectiveTop;
      if (spacer > 0) {
        if (lineIndex === 0) {
          // If the paragraph's first visual line doesn't fit, move the whole
          // paragraph with a block break. An inline widget at char 0 creates
          // unstable layout inside the paragraph itself.
          breaks.push({ pos: blockPos, spacer, kind: 'block' });
          cumulativeShift += spacer;
        } else {
          const pos = line.getPos();
          if (pos !== null) {
            const clamped = Math.max(blockPos + 2, Math.min(pos, blockEnd - 1));
            breaks.push({ pos: clamped, spacer, kind: 'inline' });
            cumulativeShift += spacer;
          }
        }
      }
    }

    pageStart = pageBoundary + PAGE_BREAK_GAP;
    pageBoundary = pageStart + CONTENT_HEIGHT;
    pageAdvances++;
  }

  return { breaks, cumulativeShift, pageStart, pageBoundary, pageAdvances };
}

export function calculateBreakLayout<Block extends PaginationBlock>({
  blocks,
  existingBreaks,
  measureParagraphLines,
  now,
  onOverflowingBlock,
  onOverflowingParagraph,
  onParagraphMeasured,
  onParagraphPaginated,
}: CalculateBreakLayoutOptions<Block>): {
  breaks: Break[];
  pageCount: number;
} {
  const sorted = [...existingBreaks].sort((a, b) => a.pos - b.pos);

  const newBreaks: Break[] = [];
  let pageStart = 0;
  let pageBoundary = CONTENT_HEIGHT;
  let pageCount = 1;
  let cumulativeShift = 0;
  let previousPassShift = 0;
  let nextPreviousBreakIndex = 0;

  for (const block of blocks) {
    while (
      nextPreviousBreakIndex < sorted.length &&
      sorted[nextPreviousBreakIndex].pos <= block.pos
    ) {
      previousPassShift += sorted[nextPreviousBreakIndex].spacer;
      nextPreviousBreakIndex++;
    }

    const blockShift = previousPassShift;
    const blockNaturalTop = block.measuredTop - blockShift;
    const blockEffectiveTop = blockNaturalTop + cumulativeShift;
    const blockEffectiveBottom = blockEffectiveTop + block.height;

    if (blockEffectiveBottom <= pageBoundary) {
      continue;
    }

    if (block.isParagraph && blockEffectiveTop < pageBoundary) {
      onOverflowingParagraph?.(block);
      const lines = measureParagraphLines(block, {
        blockNaturalTop,
        blockShift,
        cumulativeShift,
        pageStart,
        pageBoundary,
      });
      onParagraphMeasured?.(block, lines);
      const paragraphStartedAt = now?.() ?? 0;
      const result = paginateParagraph(
        lines,
        block.pos,
        block.pos + block.nodeSize,
        pageStart,
        pageBoundary,
        cumulativeShift,
      );
      onParagraphPaginated?.(
        block,
        result,
        now ? now() - paragraphStartedAt : 0,
      );
      newBreaks.push(...result.breaks);
      cumulativeShift = result.cumulativeShift;
      pageStart = result.pageStart;
      pageBoundary = result.pageBoundary;
      pageCount += result.pageAdvances;
      continue;
    }

    onOverflowingBlock?.(block);
    let spacerApplied = 0;
    if (blockEffectiveTop > pageStart) {
      const spacer = pageBoundary + PAGE_BREAK_GAP - blockEffectiveTop;
      if (spacer > 0) {
        newBreaks.push({ pos: block.pos, spacer, kind: 'block' });
        cumulativeShift += spacer;
        spacerApplied = spacer;
      }
    }

    const finalBottom = blockEffectiveTop + spacerApplied + block.height;
    do {
      pageStart = pageBoundary + PAGE_BREAK_GAP;
      pageBoundary = pageStart + CONTENT_HEIGHT;
      pageCount++;
    } while (finalBottom > pageBoundary);
  }

  return { breaks: newBreaks, pageCount };
}
