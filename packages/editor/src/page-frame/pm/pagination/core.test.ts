import { describe, expect, it } from 'vitest';
import {
  CONTENT_HEIGHT,
  calculateBreakLayout,
  type PaginationBlock,
  type ParagraphLine,
  paginateParagraph,
  paginateTableRows,
  type TableRowLine,
} from './core';

function line(
  naturalTop: number,
  naturalBottom: number,
  getPos: () => number | null = () => null,
): ParagraphLine {
  return { naturalTop, naturalBottom, getPos };
}

function tableRow(
  naturalTop: number,
  naturalBottom: number,
  getPos: () => number | null = () => null,
  options: { isHeaderRow?: boolean; splitLines?: ParagraphLine[] } = {},
): TableRowLine {
  return {
    naturalTop,
    naturalBottom,
    getPos,
    isHeaderRow: options.isHeaderRow,
    splitLines: options.splitLines,
  };
}

function block({
  pos,
  measuredTop,
  height,
  nodeSize = 10,
  isBreakableTextBlock = false,
  isBreakableTableBlock = false,
  isPageHeightConstrained = false,
  keepWithNext = false,
  forcesPageBreak = false,
}: {
  pos: number;
  measuredTop: number;
  height: number;
  nodeSize?: number;
  isBreakableTextBlock?: boolean;
  isBreakableTableBlock?: boolean;
  isPageHeightConstrained?: boolean;
  keepWithNext?: boolean;
  forcesPageBreak?: boolean;
}): PaginationBlock {
  return {
    pos,
    measuredTop,
    height,
    nodeSize,
    isBreakableTextBlock,
    isBreakableTableBlock,
    isPageHeightConstrained,
    keepWithNext,
    forcesPageBreak,
  };
}

describe('paginateParagraph', () => {
  it('leaves paragraphs unchanged when all lines fit on the current page', () => {
    const result = paginateParagraph(
      [line(12, 28), line(40, 56)],
      10,
      20,
      0,
      100,
      0,
    );

    expect(result.breaks).toEqual([]);
    expect(result.pageAdvances).toBe(0);
  });

  it('inserts an inline break at the first overflowing non-initial line', () => {
    const result = paginateParagraph(
      [line(12, 28), line(90, 110, () => 15)],
      10,
      20,
      0,
      100,
      0,
    );

    expect(result.breaks).toEqual([{ pos: 15, spacer: 146, kind: 'inline' }]);
    expect(result.pageAdvances).toBe(1);
  });

  it('uses a block break when the first visual line does not fit', () => {
    const result = paginateParagraph([line(60, 110)], 10, 20, 50, 100, 0);

    expect(result.breaks).toEqual([{ pos: 10, spacer: 176, kind: 'block' }]);
    expect(result.pageAdvances).toBe(1);
  });

  it('continues splitting a paragraph as it spans additional pages', () => {
    const result = paginateParagraph(
      [line(12, 28), line(90, 110, () => 15), line(900, 920, () => 999)],
      10,
      30,
      0,
      100,
      0,
    );

    expect(result.breaks).toEqual([
      { pos: 15, spacer: 146, kind: 'inline' },
      { pos: 29, spacer: 110, kind: 'inline' },
    ]);
    expect(result.pageAdvances).toBe(2);
  });
});

describe('calculateBreakLayout', () => {
  it('splits overflowing paragraphs at measured visual lines', () => {
    const paragraph = block({
      pos: 10,
      measuredTop: 760,
      height: 40,
      nodeSize: 20,
      isBreakableTextBlock: true,
    });
    let measurementCount = 0;

    const result = calculateBreakLayout({
      blocks: [paragraph],
      measureParagraphLines: () => {
        measurementCount++;
        return [line(760, 772), line(780, 800, () => 15)];
      },
    });

    expect(measurementCount).toBe(1);
    expect(result).toEqual({
      breaks: [{ pos: 15, spacer: 140, kind: 'inline' }],
      pageCount: 2,
    });
  });

  it('moves truly atomic blocks such as images or rules onto the next page as a whole', () => {
    const result = calculateBreakLayout({
      blocks: [block({ pos: 20, measuredTop: 760, height: 80 })],
      measureParagraphLines: () => {
        throw new Error('atomic blocks should not be split into lines');
      },
    });

    expect(result).toEqual({
      breaks: [{ pos: 20, spacer: 160, kind: 'block' }],
      pageCount: 2,
    });
  });

  it('splits overflowing tables before the first row that crosses the page boundary', () => {
    const result = calculateBreakLayout({
      blocks: [
        block({
          pos: 20,
          measuredTop: 720,
          height: 140,
          nodeSize: 60,
          isBreakableTableBlock: true,
        }),
      ],
      measureParagraphLines: () => [],
      measureTableRows: () => [
        line(680, 712, () => 21),
        line(720, 752, () => 31),
        line(760, 800, () => 41),
      ],
    });

    expect(result).toEqual({
      breaks: [{ pos: 41, spacer: 160, kind: 'table-row' }],
      pageCount: 2,
    });
  });

  it('moves a table wholesale when only its header row fits on the current page', () => {
    const result = calculateBreakLayout({
      blocks: [
        block({
          pos: 20,
          measuredTop: 720,
          height: 100,
          nodeSize: 60,
          isBreakableTableBlock: true,
        }),
      ],
      measureParagraphLines: () => [],
      measureTableRows: () => [
        tableRow(720, 752, () => 21, { isHeaderRow: true }),
        tableRow(760, 800, () => 31),
      ],
    });

    expect(result).toEqual({
      breaks: [{ pos: 20, spacer: 200, kind: 'block' }],
      pageCount: 2,
    });
  });

  it('keeps following blocks on the continuation page after an earlier paragraph split', () => {
    const result = calculateBreakLayout({
      blocks: [
        block({
          pos: 10,
          measuredTop: 760,
          height: 40,
          nodeSize: 20,
          isBreakableTextBlock: true,
        }),
        block({ pos: 30, measuredTop: 820, height: 20 }),
      ],
      measureParagraphLines: (currentBlock) =>
        currentBlock.pos === 10
          ? [line(760, 772), line(780, 800, () => 15)]
          : [],
    });

    expect(result).toEqual({
      breaks: [{ pos: 15, spacer: 140, kind: 'inline' }],
      pageCount: 2,
    });
  });

  for (const blockKind of ['heading', 'blockquote', 'list item']) {
    it(`splits overflowing ${blockKind} text line-by-line instead of moving the whole block`, () => {
      const result = calculateBreakLayout({
        blocks: [
          block({
            pos: 20,
            measuredTop: 760,
            height: 80,
            isBreakableTextBlock: true,
          }),
        ],
        measureParagraphLines: () => [line(760, 772), line(780, 800, () => 25)],
      });

      expect(result).toEqual({
        breaks: [{ pos: 25, spacer: 140, kind: 'inline' }],
        pageCount: 2,
      });
    });
  }

  it('clamps oversized code blocks to a single page and relies on Monaco scrolling for the rest', () => {
    const result = calculateBreakLayout({
      blocks: [
        block({
          pos: 30,
          measuredTop: 0,
          height: CONTENT_HEIGHT + 240,
          isPageHeightConstrained: true,
        }),
      ],
      measureParagraphLines: () => [],
    });

    expect(result).toEqual({
      breaks: [],
      pageCount: 1,
    });
  });
});

describe('calculateBreakLayout document structure', () => {
  const noLines = () => [];

  it('sizes a block break to absorb the margin gap the spacer un-collapses', () => {
    const result = calculateBreakLayout({
      blocks: [
        block({ pos: 0, measuredTop: 0, height: 740 }),
        block({ pos: 10, measuredTop: 760, height: 40 }),
      ],
      measureParagraphLines: noLines,
    });

    // 784 + 136 - 760 moves the block to the page top; the 20px margin gap no longer renders.
    expect(result.breaks).toEqual([{ pos: 10, spacer: 180, kind: 'block' }]);
  });

  it('starts the block after a slightly oversized one on the next page, not in the gap', () => {
    // A full-width portrait figure: 784px of image plus a caption runs 16px past one page.
    const result = calculateBreakLayout({
      blocks: [
        block({ pos: 0, measuredTop: 0, height: 800 }),
        block({ pos: 10, measuredTop: 818, height: 20 }),
      ],
      measureParagraphLines: noLines,
    });

    // The next page starts at 784 + 136 = 920; the 18px margin gap no longer renders.
    expect(result).toEqual({
      breaks: [{ pos: 10, spacer: 920 - 818 + 18, kind: 'block' }],
      pageCount: 2,
    });
  });

  it('starts a new page after a manual page break even when content fits', () => {
    const result = calculateBreakLayout({
      blocks: [
        block({ pos: 0, measuredTop: 0, height: 100 }),
        block({ pos: 10, measuredTop: 100, height: 0, forcesPageBreak: true }),
        block({ pos: 11, measuredTop: 100, height: 40 }),
        block({ pos: 21, measuredTop: 140, height: 40 }),
      ],
      measureParagraphLines: noLines,
    });

    expect(result).toEqual({
      breaks: [{ pos: 11, spacer: 820, kind: 'block' }],
      pageCount: 2,
    });
  });

  it('moves a heading to the next page rather than strand it above its paragraph', () => {
    const result = calculateBreakLayout({
      blocks: [
        block({
          pos: 0,
          measuredTop: 740,
          height: 30,
          isBreakableTextBlock: true,
          keepWithNext: true,
        }),
        block({
          pos: 10,
          measuredTop: 775,
          height: 60,
          isBreakableTextBlock: true,
        }),
      ],
      measureParagraphLines: (b) =>
        b.pos === 10
          ? [line(775, 795, () => 11), line(795, 835, () => 15)]
          : [],
    });

    expect(result.breaks[0]).toEqual({ pos: 0, spacer: 180, kind: 'block' });
    expect(result.pageCount).toBe(2);
  });

  it('keeps a heading in place when the first line of its paragraph fits', () => {
    const result = calculateBreakLayout({
      blocks: [
        block({
          pos: 0,
          measuredTop: 700,
          height: 30,
          isBreakableTextBlock: true,
          keepWithNext: true,
        }),
        block({
          pos: 10,
          measuredTop: 735,
          height: 80,
          isBreakableTextBlock: true,
        }),
      ],
      measureParagraphLines: (b) =>
        b.pos === 10
          ? [line(735, 755, () => 11), line(795, 815, () => 15)]
          : [],
    });

    expect(result.breaks).toEqual([{ pos: 15, spacer: 125, kind: 'inline' }]);
  });

  it('paginates against the frame geometry rather than the default page', () => {
    const result = calculateBreakLayout({
      blocks: [block({ pos: 0, measuredTop: 90, height: 40 })],
      geometry: { contentHeight: 100, breakGap: 50 },
      measureParagraphLines: noLines,
    });

    expect(result).toEqual({
      breaks: [{ pos: 0, spacer: 60, kind: 'block' }],
      pageCount: 2,
    });
  });
});

describe('paginateTableRows', () => {
  it('emits table-row breaks for rows after the opening segment', () => {
    const result = paginateTableRows(
      [
        tableRow(680, 712, () => 21, { isHeaderRow: true }),
        tableRow(720, 752, () => 31),
        tableRow(760, 800, () => 41),
      ],
      20,
      80,
      0,
      784,
      0,
    );

    expect(result.breaks).toEqual([
      { pos: 41, spacer: 160, kind: 'table-row' },
    ]);
    expect(result.pageAdvances).toBe(1);
  });

  it('moves the whole table when the header would be orphaned', () => {
    const result = paginateTableRows(
      [
        tableRow(720, 752, () => 21, { isHeaderRow: true }),
        tableRow(760, 800, () => 31),
      ],
      20,
      80,
      0,
      784,
      0,
    );

    expect(result.breaks).toEqual([{ pos: 20, spacer: 200, kind: 'block' }]);
    expect(result.pageAdvances).toBe(1);
  });

  it('does not move a non-header table wholesale when only the first row fits', () => {
    const result = paginateTableRows(
      [tableRow(720, 752, () => 21), tableRow(760, 800, () => 31)],
      20,
      80,
      0,
      784,
      0,
    );

    expect(result.breaks).toEqual([
      { pos: 31, spacer: 160, kind: 'table-row' },
    ]);
    expect(result.pageAdvances).toBe(1);
  });

  it('splits a splittable row that partially fits in the remaining page', () => {
    const result = paginateTableRows(
      [
        tableRow(720, 860, () => 21, {
          splitLines: [
            line(720, 744, () => 101),
            line(760, 784, () => 201),
            line(800, 824, () => 301),
          ],
        }),
      ],
      20,
      400,
      0,
      784,
      0,
    );

    expect(result.breaks).toEqual([{ pos: 301, spacer: 120, kind: 'inline' }]);
    expect(result.pageAdvances).toBe(1);
  });

  it('moves a splittable row when no line fits before the page boundary', () => {
    const result = paginateTableRows(
      [
        tableRow(776, 860, () => 21, {
          splitLines: [line(790, 814, () => 101), line(820, 844, () => 201)],
        }),
      ],
      20,
      400,
      0,
      784,
      0,
    );

    expect(result.breaks).toEqual([
      { pos: 21, spacer: 144, kind: 'table-row' },
    ]);
    expect(result.pageAdvances).toBe(1);
  });

  it('splits an oversized single-cell row at cell text lines', () => {
    const result = paginateTableRows(
      [
        tableRow(0, 1000, () => 21, {
          splitLines: [
            line(0, 24, () => 101),
            line(720, 744, () => 201),
            line(780, 804, () => 301),
          ],
        }),
      ],
      20,
      400,
      0,
      784,
      0,
    );

    expect(result.breaks).toEqual([{ pos: 301, spacer: 140, kind: 'inline' }]);
    expect(result.pageAdvances).toBe(1);
  });

  it('continues splitting an oversized single-cell row across later pages', () => {
    const result = paginateTableRows(
      [
        tableRow(0, 1800, () => 21, {
          splitLines: [
            line(720, 744, () => 101),
            line(780, 804, () => 201),
            line(1540, 1580, () => 301),
          ],
        }),
      ],
      20,
      400,
      0,
      784,
      0,
    );

    expect(result.breaks).toEqual([
      { pos: 201, spacer: 140, kind: 'inline' },
      { pos: 301, spacer: 160, kind: 'inline' },
    ]);
    expect(result.pageAdvances).toBe(2);
  });
});

it('moves a full-width anchored gap and its following text together to the next page', () => {
  const result = paginateParagraph(
    [
      line(740, 760, () => 11),
      { ...line(760, 840, () => 15), isAnchorGap: true },
      line(840, 860, () => 15),
    ],
    10,
    30,
    0,
    CONTENT_HEIGHT,
    0,
  );
  expect(result.breaks).toEqual([{ pos: 15, spacer: 160, kind: 'inline' }]);
  expect(result.pageAdvances).toBe(1);
});

it('breaks after a gap that fits when the line following it overflows', () => {
  const result = paginateParagraph(
    [
      { ...line(690, 770, () => 11), isAnchorGap: true },
      line(770, 796, () => 11),
    ],
    10,
    30,
    0,
    CONTENT_HEIGHT,
    0,
  );
  expect(result.breaks).toEqual([
    { pos: 11, spacer: 150, kind: 'inline', afterAnchorGap: true },
  ]);
});
