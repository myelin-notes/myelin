import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import {
  getPdfDocumentPageSizes,
  openPdfDocument,
  type PdfPageRenderHandle,
  type PdfPageSize,
  renderPdfPageToCanvas,
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
    renderPdfPageToCanvas: vi.fn(),
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

function mockOpenedPdf(pageCount: number): PDFDocumentProxy {
  const document = {
    numPages: pageCount,
    loadingTask: { destroy: vi.fn(async () => {}) },
  } as unknown as PDFDocumentProxy;
  vi.mocked(openPdfDocument).mockResolvedValueOnce(document);
  return document;
}

function mockLoadedPdf(pageSizes: PdfPageSize[]): void {
  mockOpenedPdf(pageSizes.length);
  vi.mocked(getPdfDocumentPageSizes).mockResolvedValueOnce(pageSizes);
}

interface TestCanvasContext {
  drawImage: Mock<(image: HTMLCanvasElement, dx: number, dy: number) => void>;
}

interface TestCanvas extends HTMLCanvasElement {
  testContext: TestCanvasContext;
}

function createTestCanvas(width = 1, height = 1): TestCanvas {
  const context: TestCanvasContext = { drawImage: vi.fn() };
  return {
    width,
    height,
    testContext: context,
    getContext: vi.fn(() => context),
  } as unknown as TestCanvas;
}

function stubCanvasDocument(): void {
  vi.stubGlobal('document', {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== 'canvas') {
        throw new Error(`Unexpected test element: ${tagName}`);
      }
      return createTestCanvas();
    }),
  });
}

function mockImmediatePageRender(): void {
  vi.mocked(renderPdfPageToCanvas).mockImplementation(
    ({ canvas, renderScale }): PdfPageRenderHandle => {
      canvas.width = Math.round(1000 * renderScale);
      canvas.height = Math.round(1200 * renderScale);
      return { promise: Promise.resolve(), cancel: vi.fn() };
    },
  );
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.mocked(openPdfDocument).mockReset();
  vi.mocked(getPdfDocumentPageSizes).mockReset();
  vi.mocked(renderPdfPageToCanvas).mockReset();
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
    const yMap = createPdfYMap(
      ydoc,
      [
        { w: 612, h: 792 },
        { w: 300, h: 150 },
      ],
      { pageLayout: 'horizontal' },
    );
    mockOpenedPdf(2);
    const element = new PdfElement('pdf-uuid');

    element.bindToYMap(yMap);
    await flushPromises();

    expect(element.pageLayout).toBe('horizontal');
    expect(yMap.get('pageLayout')).toBe('horizontal');
    expect(element.totalWidth).toBe(612 + PAGE_GAP + 300);
    expect(element.totalHeight).toBe(792);

    element.setPageLayout('vertical');
    expect(yMap.get('pageLayout')).toBe('vertical');
  });

  it('keeps its persisted shape when initialized before binding', () => {
    const element = new PdfElement('pdf-uuid', 'horizontal');

    expect(element.getYMapProps()).toMatchObject({
      pageLayout: 'horizontal',
      pageSizes: [{ w: 680, h: 880 }],
    });
  });

  it('repairs same-count placeholder metadata after opening the PDF', async () => {
    const ydoc = new YDocManager();
    const yMap = createPdfYMap(ydoc, [{ w: 680, h: 880 }]);
    mockLoadedPdf([{ w: 612, h: 792 }]);

    new PdfElement('pdf-uuid').bindToYMap(yMap);
    await flushPromises();

    expect(yMap.get('pageSizes')).toEqual([{ w: 612, h: 792 }]);
    expect(yMap.get('pageOrder')).toEqual([{ kind: 'pdf', originalIndex: 0 }]);
  });

  it('refreshes metadata when PDF bytes are replaced', async () => {
    const ydoc = new YDocManager();
    const yMap = createPdfYMap(ydoc, [{ w: 612, h: 792 }]);
    mockOpenedPdf(1);
    const element = new PdfElement('pdf-uuid');
    element.bindToYMap(yMap);
    await flushPromises();

    mockLoadedPdf([{ w: 360, h: 720 }]);
    yMap.set('pdfData', new Uint8Array([4, 5, 6]));
    element.syncFromYMap(['pdfData']);
    await flushPromises();

    expect(yMap.get('pageSizes')).toEqual([{ w: 360, h: 720 }]);
  });

  it('destroys the previous document when replacement bytes fail to open', async () => {
    const ydoc = new YDocManager();
    const yMap = createPdfYMap(ydoc, [{ w: 612, h: 792 }]);
    const initialDocument = mockOpenedPdf(1);
    const element = new PdfElement('pdf-uuid');
    element.bindToYMap(yMap);
    await flushPromises();

    vi.mocked(openPdfDocument).mockRejectedValueOnce(new Error('bad pdf'));
    yMap.set('pdfData', new Uint8Array([4, 5, 6]));
    element.syncFromYMap(['pdfData']);
    await flushPromises();

    expect(initialDocument.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it('does not subscribe to Y.Map changes during binding', async () => {
    const ydoc = new YDocManager();
    const yMap = createPdfYMap(ydoc, [{ w: 612, h: 792 }]);
    mockOpenedPdf(1);
    const element = new PdfElement('pdf-uuid');
    element.bindToYMap(yMap);
    await flushPromises();

    vi.mocked(openPdfDocument).mockClear();
    yMap.set('pdfData', new Uint8Array([4, 5, 6]));
    await flushPromises();

    expect(openPdfDocument).not.toHaveBeenCalled();
  });

  it('preserves a custom page order with a deleted source page', async () => {
    const ydoc = new YDocManager();
    const pageSizes = [
      { w: 612, h: 792 },
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    ];
    const pageOrder = [
      { kind: 'pdf' as const, originalIndex: 0 },
      { kind: 'pdf' as const, originalIndex: 2 },
    ];
    const yMap = createPdfYMap(ydoc, pageSizes, {
      pageOrder,
      pageOrderCustom: true,
    });
    mockOpenedPdf(3);
    let localUpdates = 0;
    ydoc.doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) {
        localUpdates++;
      }
    });

    new PdfElement('pdf-uuid').bindToYMap(yMap);
    await flushPromises();

    expect(localUpdates).toBe(0);
    expect(yMap.get('pageOrder')).toEqual(pageOrder);
  });

  it('persists blank-page insertion and source-page deletion', async () => {
    const ydoc = new YDocManager();
    const pageSizes = [
      { w: 612, h: 792 },
      { w: 300, h: 150 },
      { w: 400, h: 200 },
    ];
    const yMap = createPdfYMap(ydoc, pageSizes);
    mockOpenedPdf(3);
    const element = new PdfElement('pdf-uuid');
    const editable = element as unknown as {
      insertBlankPage(position: number): void;
      deletePage(position: number): void;
    };
    element.bindToYMap(yMap);
    await flushPromises();

    editable.insertBlankPage(1);
    expect(yMap.get('pageOrder')).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'blank', size: { w: 612, h: 792 } },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 2 },
    ]);
    expect(yMap.get('pageOrderCustom')).toBe(true);

    editable.deletePage(2);
    expect(yMap.get('pageOrder')).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'blank', size: { w: 612, h: 792 } },
      { kind: 'pdf', originalIndex: 2 },
    ]);
  });
});

describe('PdfElement thumbnail rendering', () => {
  async function createLoadedElement(): Promise<PdfElement> {
    const ydoc = new YDocManager();
    const pageSizes = [
      { w: 612, h: 792 },
      { w: 300, h: 150 },
    ];
    const yMap = createPdfYMap(ydoc, pageSizes);
    mockOpenedPdf(2);
    const element = new PdfElement('pdf-uuid');
    element.bindToYMap(yMap);
    await flushPromises();
    return element;
  }

  it('renders and draws only the page intersecting the capture region', async () => {
    const element = await createLoadedElement();
    stubCanvasDocument();
    mockImmediatePageRender();

    await element.prepareThumbnail(0.5, new DOMRect(0, 0, 612, 400));

    expect(renderPdfPageToCanvas).toHaveBeenCalledOnce();
    expect(vi.mocked(renderPdfPageToCanvas).mock.calls[0][0]).toMatchObject({
      pageIndex: 0,
      renderScale: 0.5,
    });
    const context = { drawImage: vi.fn() };
    element.drawThumbnail(context as unknown as CanvasRenderingContext2D, 0);
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      612,
      792,
    );
  });

  it('skips pages before the region and retains their layout position', async () => {
    const element = await createLoadedElement();
    stubCanvasDocument();
    mockImmediatePageRender();

    await element.prepareThumbnail(0.5, new DOMRect(0, 900, 612, 200));

    expect(renderPdfPageToCanvas).toHaveBeenCalledOnce();
    expect(vi.mocked(renderPdfPageToCanvas).mock.calls[0][0].pageIndex).toBe(1);
    const context = { drawImage: vi.fn() };
    element.drawThumbnail(context as unknown as CanvasRenderingContext2D, 0);
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      156,
      832,
      300,
      150,
    );
  });

  it('renders every page intersecting the capture region', async () => {
    const element = await createLoadedElement();
    stubCanvasDocument();
    mockImmediatePageRender();

    await element.prepareThumbnail(0.5, new DOMRect(0, 0, 612, 1500));

    expect(renderPdfPageToCanvas).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(renderPdfPageToCanvas)
        .mock.calls.map(([params]) => params.pageIndex),
    ).toEqual([0, 1]);
  });

  it('is a no-op before a PDF document is loaded', async () => {
    const element = new PdfElement('pdf-uuid');

    await element.prepareThumbnail(0.5, new DOMRect(0, 0, 612, 792));

    expect(renderPdfPageToCanvas).not.toHaveBeenCalled();
    const context = { drawImage: vi.fn() };
    element.drawThumbnail(context as unknown as CanvasRenderingContext2D, 0);
    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it('waits for an in-flight PDF load before rendering', async () => {
    const ydoc = new YDocManager();
    const yMap = createPdfYMap(ydoc, [{ w: 612, h: 792 }]);
    let resolveOpen!: (document: PDFDocumentProxy) => void;
    vi.mocked(openPdfDocument).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOpen = resolve;
      }),
    );
    stubCanvasDocument();
    mockImmediatePageRender();
    const element = new PdfElement('pdf-uuid');
    element.bindToYMap(yMap);

    const prepared = element.prepareThumbnail(0.5, new DOMRect(0, 0, 612, 792));
    expect(renderPdfPageToCanvas).not.toHaveBeenCalled();

    resolveOpen({
      numPages: 1,
      loadingTask: { destroy: vi.fn(async () => {}) },
    } as unknown as PDFDocumentProxy);
    await prepared;

    expect(renderPdfPageToCanvas).toHaveBeenCalledOnce();
  });
});
