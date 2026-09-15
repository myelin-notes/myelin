import { describe, expect, it } from 'vitest';
import {
  findCurrentPdfPage,
  getNavigatorPosition,
  getPdfPageJumpOffset,
} from './pdf-page-navigator-utils';

describe('PDF page navigator geometry', () => {
  it('uses the page with the greatest visible area', () => {
    expect(
      findCurrentPdfPage(
        [
          { left: 0, top: 0, width: 100, height: 100 },
          { left: 0, top: 110, width: 100, height: 100 },
        ],
        { left: 0, top: 60, width: 100, height: 100 },
      ),
    ).toBe(1);
  });

  it('centers over the visible PDF intersection and stays above the bottom inset', () => {
    expect(
      getNavigatorPosition({
        pdfBounds: { left: -50, top: 20, width: 200, height: 500 },
        viewport: { left: 0, top: 0, width: 300, height: 400 },
        navigatorSize: { width: 100, height: 40 },
        edgeInset: 16,
        viewportBottomInset: 16,
      }),
    ).toEqual({ left: 25, top: 344 });
  });

  it('keeps the navigator inside the viewport at narrow PDF edges', () => {
    expect(
      getNavigatorPosition({
        pdfBounds: { left: -80, top: 10, width: 100, height: 500 },
        viewport: { left: 0, top: 0, width: 300, height: 400 },
        navigatorSize: { width: 136, height: 40 },
        edgeInset: 16,
        viewportBottomInset: 88,
      }),
    ).toEqual({ left: 16, top: 272 });
  });

  it('hides when the PDF does not intersect the viewport', () => {
    expect(
      getNavigatorPosition({
        pdfBounds: { left: 400, top: 0, width: 100, height: 100 },
        viewport: { left: 0, top: 0, width: 300, height: 400 },
        navigatorSize: { width: 136, height: 40 },
        edgeInset: 16,
        viewportBottomInset: 16,
      }),
    ).toBeNull();
  });
});

describe('PDF page jump geometry', () => {
  it('centers a page that fits while preserving the requested zoom', () => {
    expect(
      getPdfPageJumpOffset({
        pageBounds: { left: 100, top: 200, width: 300, height: 400 },
        viewport: { left: 0, top: 0, width: 800, height: 600 },
        zoom: 1,
        margin: 48,
      }),
    ).toEqual({ x: 150, y: -100 });
  });

  it('aligns an oversized page to the viewport margin', () => {
    expect(
      getPdfPageJumpOffset({
        pageBounds: { left: 100, top: 200, width: 500, height: 700 },
        viewport: { left: 0, top: 0, width: 400, height: 500 },
        zoom: 2,
        margin: 48,
      }),
    ).toEqual({ x: -76, y: -176 });
  });
});
