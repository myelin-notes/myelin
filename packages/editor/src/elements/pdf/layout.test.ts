import { describe, expect, it } from 'vitest';
import {
  buildPdfLayout,
  getPdfVisiblePageRange,
  isPdfPageVisible,
} from './layout';

describe('PDF layout', () => {
  const layout = buildPdfLayout({
    pageSizes: [
      { w: 100, h: 200 },
      { w: 100, h: 300 },
      { w: 100, h: 400 },
    ],
    pageOrder: [
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 2 },
    ],
    pageLayout: 'vertical',
    defaultPageSize: { w: 100, h: 200 },
  });

  it('finds only pages inside the requested world range', () => {
    expect(
      getPdfVisiblePageRange({
        worldRect: {
          left: 0,
          right: 100,
          top: 250,
          bottom: 700,
          width: 100,
          height: 450,
        },
        offset: { x: 0, y: 0 },
        scaleX: 1,
        scaleY: 1,
        margin: 0,
        pageLayout: 'vertical',
        layout,
      }),
    ).toEqual({ start: 1, end: 3 });
  });

  it('includes a page when its vertical render margin reaches the viewport', () => {
    expect(
      isPdfPageVisible({
        worldRect: {
          left: 0,
          right: 100,
          top: 250,
          bottom: 260,
          width: 100,
          height: 10,
        },
        offset: { x: 0, y: 0 },
        localLeft: 0,
        localTop: 0,
        pageSize: { w: 100, h: 200 },
        scaleX: 1,
        scaleY: 1,
        verticalMargin: 80,
      }),
    ).toBe(true);
  });
});
