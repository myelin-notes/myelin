import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPdfDocumentPageSizes,
  openPdfDocument,
  type PdfPageSize,
} from '../../pdf-renderer';
import { LOCAL_ORIGIN, YDocManager } from '../../ydoc-manager';
import { ElementType } from '../element-type';
import { PAGE_GAP } from '../page-frame-constants';
import { PdfElement } from './index';

vi.mock('../../pdf-renderer', async () => {
  const actual =
    await vi.importActual<typeof import('../../pdf-renderer')>(
      '../../pdf-renderer',
    );
  return {
    ...actual,
    getPdfDocumentPageSizes: vi.fn(),
    openPdfDocument: vi.fn(),
  };
});

function createPdfYMap(
  ydoc: YDocManager,
  pageSizes: PdfPageSize[],
  extraProps: Record<string, unknown> = {},
) {
  return ydoc.createElementMap(ElementType.PDF, 'pdf-uuid', {
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    pdfData: new Uint8Array([1, 2, 3]),
    pageSizes,
    pageOrder: pageSizes.map((_, originalIndex) => ({
      kind: 'pdf' as const,
      originalIndex,
    })),
    fileName: 'deck.pdf',
    ...extraProps,
  });
}

function mockOpenedPdf(pageCount: number): void {
  vi.mocked(openPdfDocument).mockResolvedValueOnce({
    numPages: pageCount,
    loadingTask: { destroy: vi.fn(async () => {}) },
  } as unknown as PDFDocumentProxy);
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.mocked(openPdfDocument).mockReset();
  vi.mocked(getPdfDocumentPageSizes).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PdfElement', () => {
  it('does not dirty stored metadata that matches the opened PDF', async () => {
    const ydoc = new YDocManager();
    const pageSizes = [{ w: 612, h: 792 }];
    const yMap = createPdfYMap(ydoc, pageSizes);
    mockOpenedPdf(1);
    const element = new PdfElement('pdf-uuid');
    let localUpdates = 0;
    ydoc.doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) {
        localUpdates += 1;
      }
    });

    element.bindToYMap(yMap);
    await flushPromises();

    expect(localUpdates).toBe(0);
    expect(getPdfDocumentPageSizes).not.toHaveBeenCalled();
  });

  it('repairs placeholder metadata after opening the PDF', async () => {
    const ydoc = new YDocManager();
    const yMap = createPdfYMap(ydoc, [{ w: 680, h: 880 }]);
    mockOpenedPdf(2);
    vi.mocked(getPdfDocumentPageSizes).mockResolvedValueOnce([
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    ]);
    const element = new PdfElement('pdf-uuid');

    element.bindToYMap(yMap);
    await flushPromises();

    expect(yMap.get('pageSizes')).toEqual([
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    ]);
    expect(yMap.get('pageOrder')).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
    ]);
  });

  it('persists a layout change through its Yjs map', async () => {
    const ydoc = new YDocManager();
    const yMap = createPdfYMap(ydoc, [
      { w: 612, h: 792 },
      { w: 300, h: 150 },
    ]);
    mockOpenedPdf(2);
    const element = new PdfElement('pdf-uuid');

    element.bindToYMap(yMap);
    await flushPromises();
    element.setPageLayout('horizontal');

    expect(yMap.get('pageLayout')).toBe('horizontal');
    expect(element.totalWidth).toBe(612 + PAGE_GAP + 300);
    expect(element.totalHeight).toBe(792);
  });

  it('keeps its persisted shape when initialized before binding', () => {
    const element = new PdfElement('pdf-uuid', 'horizontal');

    expect(element.getYMapProps()).toMatchObject({
      pageLayout: 'horizontal',
      pageSizes: [{ w: 680, h: 880 }],
    });
  });
});
