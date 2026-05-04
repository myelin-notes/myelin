import type { PDFDocumentProxy } from 'pdfjs-dist';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
  getPdfDocumentPageSizes,
  openPdfDocument,
  type PdfPageSize,
} from '../pdf-renderer';
import { LOCAL_ORIGIN, YDocManager } from '../ydoc-manager';
import { ElementType } from './element-type';
import { PdfElement } from './pdf-element';

vi.mock('../pdf-renderer', async () => {
  const actual =
    await vi.importActual<typeof import('../pdf-renderer')>('../pdf-renderer');
  return {
    ...actual,
    getPdfDocumentPageSizes: vi.fn(),
    openPdfDocument: vi.fn(),
  };
});

function mockOpenedPdf(pageCount: number): {
  destroy: Mock<() => Promise<void>>;
} {
  const document = {
    numPages: pageCount,
    destroy: vi.fn(async () => {}),
  };
  vi.mocked(openPdfDocument).mockResolvedValueOnce(
    document as unknown as PDFDocumentProxy,
  );
  return document;
}

function mockPdfPageSizes(pageSizes: PdfPageSize[]): void {
  vi.mocked(getPdfDocumentPageSizes).mockResolvedValueOnce(pageSizes);
}

function mockLoadedPdf(pageSizes: PdfPageSize[]): void {
  mockOpenedPdf(pageSizes.length);
  mockPdfPageSizes(pageSizes);
}

function mockLoadedPdfWithStoredMetadata(pageSizes: PdfPageSize[]): void {
  mockOpenedPdf(pageSizes.length);
}

function createPdfYMap(
  ydoc: YDocManager,
  pageSizes: PdfPageSize[],
  pageOrder = pageSizes.map((_, originalIndex) => ({
    kind: 'pdf' as const,
    originalIndex,
  })),
) {
  return ydoc.createElementMap(ElementType.PDF, 0, {
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    pdfData: new Uint8Array([1, 2, 3]),
    pageSizes,
    pageOrder,
    fileName: 'deck.pdf',
  });
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('PdfElement metadata loading', () => {
  beforeEach(() => {
    vi.mocked(getPdfDocumentPageSizes).mockReset();
    vi.mocked(openPdfDocument).mockReset();
  });

  it('does not dirty the Y.Doc when parsed metadata matches stored metadata', async () => {
    const ydoc = new YDocManager();
    const pageSizes = [{ w: 612, h: 792 }];
    const yMap = createPdfYMap(ydoc, pageSizes);
    mockLoadedPdfWithStoredMetadata(pageSizes);

    let localUpdates = 0;
    ydoc.doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) {
        localUpdates += 1;
      }
    });

    new PdfElement(0).bindToYMap(yMap);
    await flushPromises();

    expect(localUpdates).toBe(0);
    expect(yMap.get('pageSizes')).toEqual(pageSizes);
    expect(yMap.get('pageOrder')).toEqual([{ kind: 'pdf', originalIndex: 0 }]);
    expect(getPdfDocumentPageSizes).not.toHaveBeenCalled();
  });

  it('updates stale placeholder metadata after parsing the PDF', async () => {
    const ydoc = new YDocManager();
    const yMap = createPdfYMap(ydoc, [{ w: 680, h: 880 }]);
    const parsedPageSizes = [
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    ];
    mockLoadedPdf(parsedPageSizes);

    let localUpdates = 0;
    ydoc.doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) {
        localUpdates += 1;
      }
    });

    new PdfElement(0).bindToYMap(yMap);
    await flushPromises();

    expect(localUpdates).toBe(1);
    expect(yMap.get('pageSizes')).toEqual(parsedPageSizes);
    expect(yMap.get('pageOrder')).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
    ]);
  });

  it('repairs same-count placeholder metadata after parsing the PDF', async () => {
    const ydoc = new YDocManager();
    const yMap = createPdfYMap(ydoc, [{ w: 680, h: 880 }]);
    const parsedPageSizes = [{ w: 612, h: 792 }];
    mockLoadedPdf(parsedPageSizes);

    let localUpdates = 0;
    ydoc.doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) {
        localUpdates += 1;
      }
    });

    new PdfElement(0).bindToYMap(yMap);
    await flushPromises();

    expect(localUpdates).toBe(1);
    expect(yMap.get('pageSizes')).toEqual(parsedPageSizes);
    expect(yMap.get('pageOrder')).toEqual([{ kind: 'pdf', originalIndex: 0 }]);
  });

  it('refreshes metadata when PDF bytes are replaced', async () => {
    const ydoc = new YDocManager();
    const pageSizes = [{ w: 612, h: 792 }];
    const yMap = createPdfYMap(ydoc, pageSizes);
    mockLoadedPdfWithStoredMetadata(pageSizes);

    let localUpdates = 0;
    ydoc.doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) {
        localUpdates += 1;
      }
    });

    const element = new PdfElement(0);
    element.bindToYMap(yMap);
    await flushPromises();
    expect(getPdfDocumentPageSizes).not.toHaveBeenCalled();

    const replacementPageSizes = [{ w: 360, h: 720 }];
    mockLoadedPdf(replacementPageSizes);
    yMap.set('pdfData', new Uint8Array([4, 5, 6]));
    element.syncFromYMap(['pdfData']);
    await flushPromises();

    expect(localUpdates).toBe(1);
    expect(yMap.get('pageSizes')).toEqual(replacementPageSizes);
  });

  it('destroys the previous document when replacement bytes fail to open', async () => {
    const ydoc = new YDocManager();
    const pageSizes = [{ w: 612, h: 792 }];
    const yMap = createPdfYMap(ydoc, pageSizes);
    const initialDocument = mockOpenedPdf(pageSizes.length);

    const element = new PdfElement(0);
    element.bindToYMap(yMap);
    await flushPromises();

    vi.mocked(openPdfDocument).mockRejectedValueOnce(new Error('bad pdf'));
    yMap.set('pdfData', new Uint8Array([4, 5, 6]));
    element.syncFromYMap(['pdfData']);
    await flushPromises();

    expect(initialDocument.destroy).toHaveBeenCalled();
  });

  it('does not subscribe to Y.Map changes during binding', async () => {
    const ydoc = new YDocManager();
    const pageSizes = [{ w: 612, h: 792 }];
    const yMap = createPdfYMap(ydoc, pageSizes);
    mockLoadedPdf(pageSizes);

    const element = new PdfElement(0);
    element.bindToYMap(yMap);
    await flushPromises();

    vi.mocked(openPdfDocument).mockClear();
    yMap.set('pdfData', new Uint8Array([4, 5, 6]));
    await flushPromises();

    expect(openPdfDocument).not.toHaveBeenCalled();
  });
});
