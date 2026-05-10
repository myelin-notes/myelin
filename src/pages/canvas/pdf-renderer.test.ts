import { describe, expect, it } from 'vitest';
import {
  createDefaultPdfPageOrder,
  getPdfRenderScale,
  normalizePdfPageOrder,
} from './pdf-renderer';

describe('PDF page order metadata', () => {
  it('creates an entry for every page', () => {
    expect(createDefaultPdfPageOrder(3)).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 2 },
    ]);
  });

  it('expands a stale one-page placeholder when real metadata has more pages', () => {
    expect(
      normalizePdfPageOrder([{ kind: 'pdf', originalIndex: 0 }], 3),
    ).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 2 },
    ]);
  });

  it('keeps a complete explicit order', () => {
    expect(
      normalizePdfPageOrder(
        [
          { kind: 'pdf', originalIndex: 2 },
          { kind: 'pdf', originalIndex: 1 },
          { kind: 'pdf', originalIndex: 0 },
        ],
        3,
      ),
    ).toEqual([
      { kind: 'pdf', originalIndex: 2 },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 0 },
    ]);
  });

  it('keeps blank pages when every source page is still present', () => {
    expect(
      normalizePdfPageOrder(
        [
          { kind: 'pdf', originalIndex: 0 },
          { kind: 'blank', size: { w: 612, h: 792 } },
          { kind: 'pdf', originalIndex: 1 },
        ],
        2,
      ),
    ).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'blank', size: { w: 612, h: 792 } },
      { kind: 'pdf', originalIndex: 1 },
    ]);
  });

  it('replaces duplicate entries with the complete default order', () => {
    expect(
      normalizePdfPageOrder(
        [
          { kind: 'pdf', originalIndex: 0 },
          { kind: 'pdf', originalIndex: 0 },
          { kind: 'pdf', originalIndex: 2 },
        ],
        3,
      ),
    ).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 2 },
    ]);
  });
});

describe('PDF render scale', () => {
  it('allows scale below the preferred minimum to enforce the pixel cap', () => {
    const scale = getPdfRenderScale({
      pageSize: { w: 100_000, h: 100_000 },
      zoom: 1,
      elementScale: 1,
      dpr: 1,
    });

    expect(scale).toBeCloseTo(0.04);
    expect(Math.ceil(100_000 * scale) ** 2).toBeLessThanOrEqual(16_000_000);
  });

  it('accounts for canvas dimension rounding on extreme aspect ratios', () => {
    const pageSize = { w: 1_000_000_000_000, h: 1 };
    const scale = getPdfRenderScale({
      pageSize,
      zoom: 1,
      elementScale: 1,
      dpr: 1,
    });

    expect(
      Math.ceil(pageSize.w * scale) * Math.ceil(pageSize.h * scale),
    ).toBeLessThanOrEqual(16_000_000);
    expect(Math.ceil(pageSize.w * scale)).toBeLessThanOrEqual(16_384);
    expect(Math.ceil(pageSize.h * scale)).toBeLessThanOrEqual(16_384);
  });
});
