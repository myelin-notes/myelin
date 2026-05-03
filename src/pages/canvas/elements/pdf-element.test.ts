import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPdfDocument, type PdfPageSize } from '../pdf-renderer';
import { LOCAL_ORIGIN, YDocManager } from '../ydoc-manager';
import { ElementType } from './element-type';
import { PdfElement } from './pdf-element';

vi.mock('../pdf-renderer', async () => {
  const actual =
    await vi.importActual<typeof import('../pdf-renderer')>('../pdf-renderer');
  return {
    ...actual,
    loadPdfDocument: vi.fn(),
  };
});

function mockLoadedPdf(pageSizes: PdfPageSize[]): void {
  vi.mocked(loadPdfDocument).mockResolvedValueOnce({
    document: {
      destroy: vi.fn(async () => {}),
    },
    pageSizes,
  } as unknown as Awaited<ReturnType<typeof loadPdfDocument>>);
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
    vi.mocked(loadPdfDocument).mockReset();
  });

  it('does not dirty the Y.Doc when parsed metadata matches stored metadata', async () => {
    const ydoc = new YDocManager();
    const pageSizes = [{ w: 612, h: 792 }];
    const yMap = createPdfYMap(ydoc, pageSizes);
    mockLoadedPdf(pageSizes);

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
});
