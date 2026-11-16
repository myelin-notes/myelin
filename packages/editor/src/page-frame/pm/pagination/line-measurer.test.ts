import type { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { paginateParagraph } from './core';
import {
  DomParagraphLineMeasurer,
  type ParagraphLineMeasurement,
} from './line-measurer';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DomParagraphLineMeasurer', () => {
  it('reuses line start offsets per measurer instance', () => {
    class TestText {
      public constructor(public readonly data: string) {}

      public get length(): number {
        return this.data.length;
      }
    }

    const textNode = new TestText('hello');
    const rects = [
      { top: 100, bottom: 120, left: 0, width: 30, height: 20 },
      { top: 120, bottom: 140, left: 0, width: 20, height: 20 },
    ];
    const createRange = vi.fn(() => {
      let end = textNode.length;
      let fullNodeSelected = false;
      return {
        selectNodeContents: () => {
          fullNodeSelected = true;
        },
        setStart: () => {},
        setEnd: (_node: TestText, offset: number) => {
          end = offset;
        },
        getClientRects: () =>
          fullNodeSelected || end >= 4 ? rects : rects.slice(0, 1),
      } as unknown as Range;
    });
    const createTreeWalker = vi.fn(() => {
      let visited = false;
      return {
        nextNode: () => {
          if (visited) {
            return null;
          }
          visited = true;
          return textNode;
        },
      };
    });
    vi.stubGlobal('Text', TestText);
    vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
    vi.stubGlobal('document', { createRange, createTreeWalker });
    vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '20px' }));
    const measurement: ParagraphLineMeasurement = {
      block: {
        pos: 10,
        dom: {
          clientWidth: 100,
          querySelector: () => null,
          querySelectorAll: () => [],
        } as unknown as HTMLElement,
        height: 40,
        measuredTop: 0,
        nodeSize: 7,
        isBreakableTextBlock: true,
        isBreakableTableBlock: false,
        isPageHeightConstrained: false,
      },
      view: {
        state: {
          doc: {
            nodeAt: () => ({
              content: { size: 5 },
              forEach: (visit: (child: { isText: boolean }) => void) =>
                visit({ isText: true }),
              textContent: 'hello',
            }),
          },
        },
      } as unknown as EditorView,
      editorScreenTop: 0,
      invScale: 1,
      metrics: null,
    };
    const first = new DomParagraphLineMeasurer();

    const lines = first.measure(measurement);
    const rangeCallsAfterFirstMeasurement = createRange.mock.calls.length;
    const cachedLines = first.measure(measurement);

    expect(lines.map((line) => line.getPos())).toEqual([11, 14]);
    expect(cachedLines.map((line) => line.getPos())).toEqual([11, 14]);
    // One range to read the rects; the per-line binary search is skipped.
    expect(createRange).toHaveBeenCalledTimes(
      rangeCallsAfterFirstMeasurement + 1,
    );
    const rangeCallsAfterCachedMeasurement = createRange.mock.calls.length;

    new DomParagraphLineMeasurer().measure(measurement);
    expect(createRange.mock.calls.length).toBeGreaterThan(
      rangeCallsAfterCachedMeasurement + 1,
    );
  });
});

describe('DomParagraphLineMeasurer with a second font on a line', () => {
  type TestRect = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width' | 'height'>;
  const rect = (top: number, bottom: number): TestRect => ({
    top,
    bottom,
    left: 0,
    width: 50,
    height: bottom - top,
  });

  // Each text node holds one rect per visual line it touches, as `Range#getClientRects` reports them.
  function measureRuns(runs: TestRect[][]) {
    class TestText {
      public readonly data = 'x'.repeat(40);
      public constructor(public readonly rects: TestRect[]) {}
      public get length(): number {
        return this.data.length;
      }
    }
    const textNodes = runs.map((rects) => new TestText(rects));
    vi.stubGlobal('Text', TestText);
    vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
    vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '26px' }));
    vi.stubGlobal('document', {
      createRange: () => {
        let node: TestText;
        let end: number | null = null;
        return {
          selectNodeContents: (next: TestText) => {
            node = next;
          },
          setStart: (next: TestText) => {
            node = next;
          },
          setEnd: (_next: TestText, offset: number) => {
            end = offset;
          },
          getClientRects: () =>
            end === null
              ? node.rects
              : node.rects.slice(
                  0,
                  Math.ceil((end / node.length) * node.rects.length),
                ),
        };
      },
      createTreeWalker: () => {
        let index = 0;
        return { nextNode: () => textNodes[index++] ?? null };
      },
    });
    const measurement: ParagraphLineMeasurement = {
      block: {
        pos: 10,
        dom: {
          clientWidth: 584,
          querySelector: () => null,
          querySelectorAll: () => [],
        } as unknown as HTMLElement,
        height: 78,
        measuredTop: 0,
        nodeSize: 200,
        isBreakableTextBlock: true,
        isBreakableTableBlock: false,
        isPageHeightConstrained: false,
      },
      view: {
        state: {
          doc: {
            nodeAt: () => ({
              content: { size: 198 },
              forEach: (visit: (child: { isText: boolean }) => void) =>
                visit({ isText: true }),
              textContent: 'x'.repeat(198),
            }),
          },
        },
      } as unknown as EditorView,
      editorScreenTop: 0,
      invScale: 1,
      metrics: null,
    };
    return new DomParagraphLineMeasurer().measure(measurement);
  }

  // Rects captured from the iPad simulator: mono text starts 1px above the sans text beside it.
  const sans = [rect(741, 762), rect(767, 788), rect(793, 814)];
  const mono = [rect(740, 762), rect(766, 788), rect(792, 814)];

  it('breaks a paragraph that crosses the page instead of collapsing its lines', () => {
    const lines = measureRuns([
      [sans[0]],
      [mono[0]],
      [sans[0]],
      [mono[1]],
      [sans[1]],
      [mono[2]],
      [sans[2]],
    ]);

    expect(lines.map((line) => line.naturalTop)).toEqual([741, 767, 793]);
    expect(lines.map((line) => line.naturalBottom)).toEqual([762, 788, 814]);
    const { breaks } = paginateParagraph(lines, 10, 210, 0, 784, 0);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].kind).toBe('inline');
  });
});

it('reports a reserved anchor gap as its own line', () => {
  const anchor = {
    offsetHeight: 80,
    getBoundingClientRect: () => new DOMRect(0, 170, 100, 80),
  };
  vi.stubGlobal('document', {
    createRange: () => ({}),
    createTreeWalker: () => ({ nextNode: () => null }),
  });
  vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
  const blockDom = {
    querySelector: () => anchor,
    querySelectorAll: () => [anchor],
  };
  const measurement: ParagraphLineMeasurement = {
    block: {
      pos: 10,
      dom: blockDom as unknown as HTMLElement,
      height: 250,
      measuredTop: 0,
      nodeSize: 20,
      isBreakableTextBlock: true,
      isBreakableTableBlock: false,
      isPageHeightConstrained: false,
    },
    view: { posAtDOM: () => 15 } as unknown as EditorView,
    editorScreenTop: 0,
    invScale: 1,
    metrics: null,
  };
  const lines = new DomParagraphLineMeasurer().measure(measurement);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    naturalTop: 170,
    naturalBottom: 250,
    isAnchorGap: true,
  });
  expect(lines[0].getPos()).toBe(15);
});
