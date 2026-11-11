export const PAGE_HEIGHT = 880;
export const PAGE_PADDING = 48;
export const PAGE_GAP = 40;
// Also surfaced to CSS as --pm-content-height (see plugin.ts / editor-blocks.css)
// so the page-capped block max-height tracks this constant.
export const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_PADDING * 2; // 784
export const PAGE_BREAK_GAP = PAGE_PADDING + PAGE_GAP + PAGE_PADDING; // 136

/** Page dimensions in CSS px; per frame, since page size and margins are document settings. */
export interface PageGeometry {
  contentHeight: number;
  /** Distance from the bottom of one page's content to the top of the next's. */
  breakGap: number;
}

export const DEFAULT_PAGE_GEOMETRY: PageGeometry = {
  contentHeight: CONTENT_HEIGHT,
  breakGap: PAGE_BREAK_GAP,
};

export type BreakKind = 'block' | 'inline' | 'table-row';

export interface Break {
  pos: number;
  spacer: number;
  kind: BreakKind;
  /** Renders after the anchor gap at the same position instead of before it. */
  afterAnchorGap?: boolean;
  /** Renders before embed widgets at the same position, which otherwise come first. */
  beforeEmbeds?: boolean;
}

export interface ParagraphPaginationResult {
  breaks: Break[];
  cumulativeShift: number;
  pageStart: number;
  pageBoundary: number;
  pageAdvances: number;
}

/**
 * One visual line inside a paragraph, in CSS pixels relative to the editor content top, measured
 * with pagination spacers hidden. `getPos` is lazy — called only when the loop decides to emit a
 * break at this line, so measurers can defer expensive DOM lookups.
 */
export interface ParagraphLine {
  isAnchorGap?: boolean;
  naturalTop: number;
  naturalBottom: number;
  getPos: () => number | null;
}

export interface TableRowLine extends ParagraphLine {
  isHeaderRow?: boolean;
  splitLines?: ParagraphLine[];
  measureSplitLines?: () => ParagraphLine[];
}

export interface PaginationBlock {
  pos: number;
  measuredTop: number;
  height: number;
  nodeSize: number;
  isBreakableTextBlock: boolean;
  isBreakableTableBlock: boolean;
  isPageHeightConstrained: boolean;
  /** Moves to the next page rather than end a page without the block after it. */
  keepWithNext?: boolean;
  /** A manual page break: whatever follows starts a new page. */
  forcesPageBreak?: boolean;
  isEmbed?: boolean;
}

interface CalculateBreakLayoutOptions<Block extends PaginationBlock> {
  blocks: readonly Block[];
  geometry?: PageGeometry;
  measureParagraphLines: (block: Block) => ParagraphLine[];
  measureTableRows?: (block: Block) => TableRowLine[];
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
 * The *only* pagination algorithm for paragraphs. It walks lines in order, checks whether each crosses the current page boundary
 * in effective coordinates (natural + accumulated shift), and emits a widget break when one does.
 */
export function paginateParagraph(
  lines: ParagraphLine[],
  blockPos: number,
  blockEnd: number,
  initialPageStart: number,
  initialPageBoundary: number,
  initialCumulativeShift: number,
  { contentHeight, breakGap }: PageGeometry = DEFAULT_PAGE_GEOMETRY,
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
      const spacer = pageBoundary + breakGap - lineEffectiveTop;
      if (spacer > 0) {
        if (lineIndex === 0) {
          // If the paragraph's first visual line doesn't fit, move the whole paragraph with a block break:
          // an inline widget at char 0 creates unstable layout inside the paragraph itself.
          breaks.push({ pos: blockPos, spacer, kind: 'block' });
          cumulativeShift += spacer;
        } else {
          const pos = line.getPos();
          // The line after a gap starts at the gap's position; breaking before the gap would push it
          // a page minus its own height, straddling the boundary.
          const afterAnchorGap = lines[lineIndex - 1].isAnchorGap === true;
          if (pos !== null) {
            const clamped = Math.max(
              blockPos + (line.isAnchorGap || afterAnchorGap ? 1 : 2),
              Math.min(pos, blockEnd - 1),
            );
            breaks.push({
              pos: clamped,
              spacer,
              kind: 'inline',
              ...(afterAnchorGap && { afterAnchorGap }),
            });
            cumulativeShift += spacer;
          }
        }
      }
    }

    pageStart = pageBoundary + breakGap;
    pageBoundary = pageStart + contentHeight;
    pageAdvances++;
  }

  return { breaks, cumulativeShift, pageStart, pageBoundary, pageAdvances };
}

export function paginateTableRows(
  rows: TableRowLine[],
  tablePos: number,
  tableEnd: number,
  initialPageStart: number,
  initialPageBoundary: number,
  initialCumulativeShift: number,
  tableNaturalTop: number = rows[0]?.naturalTop ?? 0,
  { contentHeight, breakGap }: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): ParagraphPaginationResult {
  const breaks: Break[] = [];
  let pageStart = initialPageStart;
  let pageBoundary = initialPageBoundary;
  let cumulativeShift = initialCumulativeShift;
  let pageAdvances = 0;
  let segmentStartRowIndex = 0;
  let headerRowCount = 0;
  const splitLineCache = new Map<TableRowLine, ParagraphLine[]>();

  while (
    headerRowCount < rows.length &&
    rows[headerRowCount].isHeaderRow === true
  ) {
    headerRowCount++;
  }
  if (headerRowCount === rows.length) {
    headerRowCount = 0;
  }

  const advancePage = () => {
    pageStart = pageBoundary + breakGap;
    pageBoundary = pageStart + contentHeight;
    pageAdvances++;
  };

  const getSplitLines = (row: TableRowLine): ParagraphLine[] => {
    const cached = splitLineCache.get(row);
    if (cached) {
      return cached;
    }

    const splitLines = row.splitLines ?? row.measureSplitLines?.() ?? [];
    splitLineCache.set(row, splitLines);
    return splitLines;
  };

  const splitInsideRow = (row: TableRowLine): boolean => {
    const splitLines = getSplitLines(row);
    if (splitLines.length === 0) {
      return false;
    }

    let didSplit = false;
    let segmentHasFittingLine = false;

    for (const line of splitLines) {
      const lineEffectiveTop = line.naturalTop + cumulativeShift;
      const lineEffectiveBottom = line.naturalBottom + cumulativeShift;

      if (lineEffectiveBottom <= pageBoundary) {
        if (lineEffectiveBottom > pageStart) {
          segmentHasFittingLine = true;
        }
        continue;
      }

      let appliedSpacer = 0;
      if (lineEffectiveTop > pageStart && segmentHasFittingLine) {
        const spacer = pageBoundary + breakGap - lineEffectiveTop;
        if (spacer > 0) {
          const pos = line.getPos();
          if (pos !== null) {
            const clamped = Math.max(tablePos + 1, Math.min(pos, tableEnd - 1));
            breaks.push({ pos: clamped, spacer, kind: 'inline' });
            cumulativeShift += spacer;
            appliedSpacer = spacer;
            didSplit = true;
          }
        }
      }

      if (!didSplit) {
        return false;
      }

      const shiftedLineBottom = lineEffectiveBottom + appliedSpacer;
      do {
        advancePage();
      } while (shiftedLineBottom > pageBoundary);

      segmentHasFittingLine = shiftedLineBottom > pageStart;
    }

    if (!didSplit) {
      return false;
    }

    const shiftedRowBottom = row.naturalBottom + cumulativeShift;
    while (shiftedRowBottom > pageBoundary) {
      advancePage();
    }

    return true;
  };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const rowEffectiveTop = row.naturalTop + cumulativeShift;
    const rowEffectiveBottom = row.naturalBottom + cumulativeShift;

    if (rowEffectiveBottom <= pageBoundary) {
      continue;
    }

    const rowHeight = row.naturalBottom - row.naturalTop;
    const canSplitInsideRow =
      row.splitLines !== undefined || row.measureSplitLines !== undefined;
    if (
      canSplitInsideRow &&
      (rowHeight > contentHeight || rowEffectiveTop < pageBoundary) &&
      splitInsideRow(row)
    ) {
      segmentStartRowIndex = rowIndex;
      continue;
    }

    if (rowEffectiveTop <= pageStart) {
      do {
        advancePage();
      } while (rowEffectiveBottom > pageBoundary);
      segmentStartRowIndex = rowIndex;
      continue;
    }

    const shouldMoveWholeTable =
      headerRowCount > 0 &&
      segmentStartRowIndex === 0 &&
      rowIndex <= headerRowCount &&
      tableNaturalTop + cumulativeShift > pageStart;
    const breakTop = shouldMoveWholeTable
      ? tableNaturalTop + cumulativeShift
      : rowEffectiveTop;
    const spacer = pageBoundary + breakGap - breakTop;
    if (spacer > 0) {
      if (shouldMoveWholeTable) {
        breaks.push({ pos: tablePos, spacer, kind: 'block' });
      } else {
        const pos = row.getPos();
        if (pos !== null) {
          const clamped = Math.max(tablePos + 1, Math.min(pos, tableEnd - 1));
          breaks.push({ pos: clamped, spacer, kind: 'table-row' });
          segmentStartRowIndex = rowIndex;
        }
      }

      cumulativeShift += spacer;
    }

    const shiftedRowBottom = rowEffectiveBottom + Math.max(spacer, 0);
    do {
      advancePage();
    } while (shiftedRowBottom > pageBoundary);
  }

  return { breaks, cumulativeShift, pageStart, pageBoundary, pageAdvances };
}

export function calculateBreakLayout<Block extends PaginationBlock>({
  blocks,
  geometry = DEFAULT_PAGE_GEOMETRY,
  measureParagraphLines,
  measureTableRows,
  now,
  onOverflowingBlock,
  onOverflowingParagraph,
  onParagraphMeasured,
  onParagraphPaginated,
}: CalculateBreakLayoutOptions<Block>): {
  breaks: Break[];
  pageCount: number;
} {
  const { contentHeight, breakGap } = geometry;
  const newBreaks: Break[] = [];
  let pageStart = 0;
  let pageBoundary = contentHeight;
  let pageCount = 1;
  let cumulativeShift = 0;
  let previousBottom: number | null = null;
  let forceBreak = false;

  const advancePage = () => {
    pageStart = pageBoundary + breakGap;
    pageBoundary = pageStart + contentHeight;
    pageCount++;
  };

  // The bottom of the smallest piece of `block` that must share a page with what precedes it.
  const firstPieceBottom = (block: Block): number => {
    if (block.isBreakableTextBlock) {
      const first = measureParagraphLines(block)[0];
      return first ? first.naturalBottom : block.measuredTop + block.height;
    }
    if (block.isBreakableTableBlock && measureTableRows) {
      const rows = measureTableRows(block);
      const firstBody = rows.find((row) => !row.isHeaderRow) ?? rows[0];
      return firstBody ? firstBody.naturalBottom : block.measuredTop;
    }
    return (
      block.measuredTop +
      (block.isPageHeightConstrained
        ? Math.min(block.height, contentHeight)
        : block.height)
    );
  };

  // Walks a run of keep-with-next blocks to the first block that isn't one.
  const strandedAtPageEnd = (index: number): boolean => {
    let next = index + 1;
    while (blocks[next]?.keepWithNext) {
      next++;
    }
    const follower = blocks[next];
    if (!follower || follower.forcesPageBreak) {
      return false;
    }
    if (
      follower.measuredTop + follower.height + cumulativeShift <=
      pageBoundary
    ) {
      return false;
    }
    return firstPieceBottom(follower) + cumulativeShift > pageBoundary;
  };

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    // A spacer stops the margins around it collapsing, so editor-base.css zeroes them and the
    // spacer absorbs the gap they occupied. Without this a block's position would depend on
    // whether it already has a break, and layout on edit history.
    const marginGap =
      previousBottom === null
        ? 0
        : Math.max(0, block.measuredTop - previousBottom);
    previousBottom = block.measuredTop + block.height;

    if (block.forcesPageBreak) {
      forceBreak = true;
      continue;
    }

    const withMarginGap = (breaks: readonly Break[]): Break[] =>
      breaks.map((b) =>
        b.kind === 'block' && b.pos === block.pos
          ? { ...b, spacer: b.spacer + marginGap }
          : b,
      );

    // A block taller than a page can end short of the page it spilled onto; what follows it would
    // otherwise sit in the gap between sheets. 0.5px absorbs float noise from earlier spacers.
    const shortOfPage = pageStart - (block.measuredTop + cumulativeShift);
    if (shortOfPage > 0.5) {
      newBreaks.push({
        pos: block.pos,
        spacer: shortOfPage + marginGap,
        kind: 'block',
        ...(block.isEmbed && { beforeEmbeds: true }),
      });
      cumulativeShift += shortOfPage;
    }

    const startsMidPage = () => {
      const top = block.measuredTop + cumulativeShift;
      return top > pageStart && top < pageBoundary;
    };
    if (
      (forceBreak || (block.keepWithNext && strandedAtPageEnd(index))) &&
      startsMidPage()
    ) {
      const spacer =
        pageBoundary + breakGap - (block.measuredTop + cumulativeShift);
      newBreaks.push({
        pos: block.pos,
        spacer: spacer + marginGap,
        kind: 'block',
        ...(block.isEmbed && { beforeEmbeds: true }),
      });
      cumulativeShift += spacer;
      advancePage();
    }
    forceBreak = false;

    const blockEffectiveTop = block.measuredTop + cumulativeShift;
    const blockHeight = block.isPageHeightConstrained
      ? Math.min(block.height, contentHeight)
      : block.height;
    const blockEffectiveBottom = blockEffectiveTop + blockHeight;

    if (blockEffectiveBottom <= pageBoundary) {
      continue;
    }

    if (block.isBreakableTextBlock && blockEffectiveTop < pageBoundary) {
      onOverflowingParagraph?.(block);
      const lines = measureParagraphLines(block);
      onParagraphMeasured?.(block, lines);
      const paragraphStartedAt = now?.() ?? 0;
      const result = paginateParagraph(
        lines,
        block.pos,
        block.pos + block.nodeSize,
        pageStart,
        pageBoundary,
        cumulativeShift,
        geometry,
      );
      onParagraphPaginated?.(
        block,
        result,
        now ? now() - paragraphStartedAt : 0,
      );
      newBreaks.push(...withMarginGap(result.breaks));
      cumulativeShift = result.cumulativeShift;
      pageStart = result.pageStart;
      pageBoundary = result.pageBoundary;
      pageCount += result.pageAdvances;
      continue;
    }

    if (
      block.isBreakableTableBlock &&
      blockEffectiveTop < pageBoundary &&
      measureTableRows
    ) {
      const rows = measureTableRows(block);
      const tableStartedAt = now?.() ?? 0;
      const result = paginateTableRows(
        rows,
        block.pos,
        block.pos + block.nodeSize,
        pageStart,
        pageBoundary,
        cumulativeShift,
        block.measuredTop,
        geometry,
      );
      onParagraphPaginated?.(block, result, now ? now() - tableStartedAt : 0);
      newBreaks.push(...withMarginGap(result.breaks));
      cumulativeShift = result.cumulativeShift;
      pageStart = result.pageStart;
      pageBoundary = result.pageBoundary;
      pageCount += result.pageAdvances;
      continue;
    }

    onOverflowingBlock?.(block);
    let spacerApplied = 0;
    if (blockEffectiveTop > pageStart) {
      const spacer = pageBoundary + breakGap - blockEffectiveTop;
      if (spacer > 0) {
        newBreaks.push({
          pos: block.pos,
          spacer: spacer + marginGap,
          kind: 'block',
          ...(block.isEmbed && { beforeEmbeds: true }),
        });
        cumulativeShift += spacer;
        spacerApplied = spacer;
      }
    }

    const finalBottom = blockEffectiveTop + spacerApplied + blockHeight;
    do {
      advancePage();
    } while (finalBottom > pageBoundary);
  }

  return { breaks: newBreaks, pageCount };
}
