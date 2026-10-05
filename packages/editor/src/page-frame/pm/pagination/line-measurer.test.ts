import type { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DomParagraphLineMeasurer,
  type ParagraphLineMeasurement,
  PretextParagraphLineMeasurer,
} from './line-measurer';

vi.mock('@chenglou/pretext', () => ({
  prepareWithSegments: vi.fn(() => ({ segments: ['hello'] })),
  layoutWithLines: vi.fn(() => ({
    lines: [
      { start: { segmentIndex: 0, graphemeIndex: 0 } },
      { start: { segmentIndex: 0, graphemeIndex: 3 } },
    ],
  })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PretextParagraphLineMeasurer', () => {
  it('maps measured line starts back to ProseMirror positions', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      fontFamily: 'sans-serif',
      fontSize: '16px',
      fontStyle: 'normal',
      fontWeight: '400',
      lineHeight: '24px',
    }));
    const measurement: ParagraphLineMeasurement = {
      block: {
        pos: 10,
        dom: { clientWidth: 300 } as HTMLElement,
        height: 48,
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
              forEach: () => {},
              textContent: 'hello',
            }),
          },
        },
      } as unknown as EditorView,
      editorScreenTop: 0,
      invScale: 1,
      blockNaturalTop: 100,
      blockShift: 0,
      metrics: null,
      measurementCacheGeneration: 0,
    };

    const lines = new PretextParagraphLineMeasurer().measure(measurement);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ naturalTop: 100, naturalBottom: 124 });
    expect(lines[1].getPos()).toBe(14);
  });
});

describe('DomParagraphLineMeasurer', () => {
  it('caches line results per measurer instance', () => {
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
        dom: { clientWidth: 100 } as HTMLElement,
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
      blockNaturalTop: 100,
      blockShift: 0,
      metrics: null,
      measurementCacheGeneration: 1,
    };
    const first = new DomParagraphLineMeasurer();

    const lines = first.measure(measurement);
    const rangeCallsAfterFirstMeasurement = createRange.mock.calls.length;
    const cachedLines = first.measure(measurement);

    expect(lines.map((line) => line.getPos())).toEqual([11, 14]);
    expect(cachedLines.map((line) => line.getPos())).toEqual([11, 14]);
    expect(createRange).toHaveBeenCalledTimes(rangeCallsAfterFirstMeasurement);

    new DomParagraphLineMeasurer().measure(measurement);
    expect(createRange.mock.calls.length).toBeGreaterThan(
      rangeCallsAfterFirstMeasurement,
    );
  });
});
