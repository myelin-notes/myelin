import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultPdfPageOrder,
  getPdfPageTexts,
  getPdfRenderScale,
  normalizePdfPageOrder,
  openPdfDocument,
} from './pdf-renderer';

// Node loads pdf.js's worker in-process from a file URL; Vite's `?url` path only resolves in a browser.
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', async () => {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const workerPath = createRequire(import.meta.url).resolve(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
  );
  return { default: pathToFileURL(workerPath).href };
});

const HELLO_PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R
  /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 42 >> stream
BT /F1 12 Tf 20 100 Td (Hello heron) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`;

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

  it('keeps missing source pages only for custom page orders', () => {
    expect(
      normalizePdfPageOrder(
        [
          { kind: 'pdf', originalIndex: 0 },
          { kind: 'pdf', originalIndex: 2 },
        ],
        3,
        { w: 612, h: 792 },
        true,
      ),
    ).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 2 },
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

  it('replaces duplicate entries even when every source page is present', () => {
    expect(
      normalizePdfPageOrder(
        [
          { kind: 'pdf', originalIndex: 0 },
          { kind: 'pdf', originalIndex: 0 },
          { kind: 'pdf', originalIndex: 1 },
        ],
        2,
      ),
    ).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
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

describe('PDF text extraction', () => {
  it('reads page text without async-iterating streams, which WebKit lacks', async () => {
    const asyncIterator = Object.getOwnPropertyDescriptor(
      ReadableStream.prototype,
      Symbol.asyncIterator,
    );
    Reflect.deleteProperty(ReadableStream.prototype, Symbol.asyncIterator);
    try {
      const document = await openPdfDocument(
        new TextEncoder().encode(HELLO_PDF),
      );
      expect(await getPdfPageTexts(document)).toEqual(['Hello heron']);
    } finally {
      if (asyncIterator) {
        Object.defineProperty(
          ReadableStream.prototype,
          Symbol.asyncIterator,
          asyncIterator,
        );
      }
    }
  });
});
