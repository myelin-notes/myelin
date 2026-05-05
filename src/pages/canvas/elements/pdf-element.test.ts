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
    renderPdfPageToCanvas: vi.fn(),
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

function mockImmediatePageRender(): void {
  vi.mocked(renderPdfPageToCanvas).mockImplementation(
    ({ canvas, renderScale }): PdfPageRenderHandle => {
      canvas.width = Math.round(1000 * renderScale);
      canvas.height = Math.round(1200 * renderScale);
      return {
        promise: Promise.resolve(),
        cancel: vi.fn(),
      };
    },
  );
}

interface TestCanvasContext {
  drawImage: Mock<(image: HTMLCanvasElement, dx: number, dy: number) => void>;
}

interface TestCanvas extends HTMLCanvasElement {
  testContext: TestCanvasContext;
}

interface TestPageDom {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  renderHandle: PdfPageRenderHandle | null;
  renderedPageIndex: number | null;
  renderedScale: number | null;
  renderingPageIndex: number | null;
  renderingScale: number | null;
  pendingRenderTimeout: number | null;
  pendingPageIndex: number | null;
  pendingRenderScale: number | null;
  pendingZoom: number | null;
}

interface TestablePdfElement {
  _pdfDocument: PDFDocumentProxy | null;
  requestPageRender: (
    pageDom: TestPageDom,
    pageIndex: number,
    pageSize: PdfPageSize,
    renderScale: number,
    zoom: number,
  ) => void;
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

function createTestCanvas(width = 1, height = 1): TestCanvas {
  const context: TestCanvasContext = {
    drawImage: vi.fn(),
  };
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

function createPageDom(
  renderedScale: number | null = null,
  canvas: HTMLCanvasElement = createTestCanvas(),
): TestPageDom {
  return {
    root: {} as HTMLDivElement,
    canvas,
    renderHandle: null,
    renderedPageIndex: renderedScale === null ? null : 0,
    renderedScale,
    renderingPageIndex: null,
    renderingScale: null,
    pendingRenderTimeout: null,
    pendingPageIndex: null,
    pendingRenderScale: null,
    pendingZoom: null,
  };
}

function createRenderableElement(): TestablePdfElement {
  const element = new PdfElement(0) as unknown as TestablePdfElement;
  element._pdfDocument = {
    numPages: 1,
    destroy: vi.fn(async () => {}),
  } as unknown as PDFDocumentProxy;
  return element;
}

beforeEach(() => {
  vi.mocked(getPdfDocumentPageSizes).mockReset();
  vi.mocked(openPdfDocument).mockReset();
  vi.mocked(renderPdfPageToCanvas).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PdfElement metadata loading', () => {
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

describe('PdfElement page rendering', () => {
  it('debounces zoom-driven rerenders after the page has rendered once', () => {
    const pageSize = { w: 612, h: 792 };
    const element = createRenderableElement();
    stubCanvasDocument();
    mockImmediatePageRender();

    element.requestPageRender(createPageDom(), 0, pageSize, 1, 1);

    expect(renderPdfPageToCanvas).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderPdfPageToCanvas).mock.calls[0][0].renderScale).toBe(
      1,
    );

    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    const renderedPageDom = createPageDom(1);
    element.requestPageRender(renderedPageDom, 0, pageSize, 1.25, 1.1);
    vi.advanceTimersByTime(80);
    element.requestPageRender(renderedPageDom, 0, pageSize, 1.25, 1.2);

    expect(renderPdfPageToCanvas).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(119);
    expect(renderPdfPageToCanvas).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(renderPdfPageToCanvas).toHaveBeenCalledTimes(2);
    expect(vi.mocked(renderPdfPageToCanvas).mock.calls[1][0].renderScale).toBe(
      1.25,
    );
  });

  it('keeps the visible canvas unchanged until the replacement render is ready', async () => {
    const pageSize = { w: 612, h: 792 };
    const element = createRenderableElement();
    const visibleCanvas = createTestCanvas(1224, 1584);
    const pageDom = createPageDom(1, visibleCanvas);
    stubCanvasDocument();
    mockImmediatePageRender();
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    element.requestPageRender(pageDom, 0, pageSize, 1.25, 1.2);
    vi.advanceTimersByTime(120);

    const renderCanvas = vi.mocked(renderPdfPageToCanvas).mock.calls[0][0]
      .canvas;
    expect(renderCanvas).not.toBe(visibleCanvas);
    expect(visibleCanvas.width).toBe(1224);
    expect(visibleCanvas.height).toBe(1584);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(visibleCanvas.width).toBe(1250);
    expect(visibleCanvas.height).toBe(1500);
    expect(visibleCanvas.testContext.drawImage).toHaveBeenCalledWith(
      renderCanvas,
      0,
      0,
    );
    expect(renderCanvas.width).toBe(1);
    expect(renderCanvas.height).toBe(1);
  });
});
