import type { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
