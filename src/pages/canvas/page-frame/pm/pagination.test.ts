import { describe, expect, it } from 'vitest';
import {
  CONTENT_HEIGHT,
  calculateBreakLayout,
  type PaginationBlock,
  type ParagraphLine,
  paginateParagraph,
} from './pagination-core';

function line(
  naturalTop: number,
  naturalBottom: number,
  getPos: () => number | null = () => null,
): ParagraphLine {
  return { naturalTop, naturalBottom, getPos };
}

function block({
  pos,
  measuredTop,
  height,
  nodeSize = 10,
  isParagraph = false,
}: {
  pos: number;
  measuredTop: number;
  height: number;
  nodeSize?: number;
  isParagraph?: boolean;
}): PaginationBlock {
  return {
    pos,
    measuredTop,
    height,
    nodeSize,
    isParagraph,
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
      isParagraph: true,
    });
    let measurementCount = 0;

    const result = calculateBreakLayout({
      blocks: [paragraph],
      existingBreaks: [],
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
      existingBreaks: [],
      measureParagraphLines: () => {
        throw new Error('atomic blocks should not be split into lines');
      },
    });

    expect(result).toEqual({
      breaks: [{ pos: 20, spacer: 160, kind: 'block' }],
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
          isParagraph: true,
        }),
        block({ pos: 30, measuredTop: 820, height: 20 }),
      ],
      existingBreaks: [],
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
          }),
        ],
        existingBreaks: [],
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
        }),
      ],
      existingBreaks: [],
      measureParagraphLines: () => [],
    });

    expect(result).toEqual({
      breaks: [],
      pageCount: 1,
    });
  });
});
