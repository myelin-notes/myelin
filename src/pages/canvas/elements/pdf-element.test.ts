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
  type PdfPageOrderEntry,
  type PdfPageRenderHandle,
  type PdfPageSize,
  renderPdfPageToCanvas,
} from '../pdf-renderer';
import { LOCAL_ORIGIN, YDocManager } from '../ydoc-manager';
import { ElementType } from './element-type';
import { PAGE_GAP } from './page-frame-constants';
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
  root: HTMLDivElement & { remove: Mock<() => void> };
  canvas: HTMLCanvasElement;
  renderHandle: PdfPageRenderHandle | null;
  rendered: TestRenderKey | null;
  rendering: TestRenderKey | null;
  pendingRender: TestPendingRender | null;
}

interface TestRenderKey {
  pageIndex: number;
  renderScale: number;
}

interface TestPendingRender {
  key: TestRenderKey;
  timeout: number;
  zoom: number;
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

interface TestablePdfInsertion {
  insertBlankPage: (position: number) => void;
  deletePage: (position: number) => void;
  getYMapProps: () => Record<string, unknown>;
}

interface TestablePdfPageDomState extends TestablePdfInsertion {
  _pageSizes: PdfPageSize[];
  _pageOrder: PdfPageOrderEntry[];
  _pageDoms: Map<number, TestPageDom>;
  _layout: unknown | null;
}

interface TestablePdfLayoutState extends TestablePdfPageDomState {
  getLayout: () => {
    pages: Array<{
      size: PdfPageSize;
      localLeft: number;
      localTop: number;
    }>;
    totalWidth: number;
    totalHeight: number;
  };
}

function createPdfYMap(
  ydoc: YDocManager,
  pageSizes: PdfPageSize[],
  pageOrder = pageSizes.map((_, originalIndex) => ({
    kind: 'pdf' as const,
    originalIndex,
  })),
  extraProps: Record<string, unknown> = {},
) {
  return ydoc.createElementMap(ElementType.PDF, 'pdf-uuid', {
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    pdfData: new Uint8Array([1, 2, 3]),
    pageSizes,
    pageOrder,
    fileName: 'deck.pdf',
    ...extraProps,
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
  existingRenderScale: number | null = null,
  canvas: HTMLCanvasElement = createTestCanvas(),
): TestPageDom {
  return {
    root: { remove: vi.fn() } as unknown as HTMLDivElement & {
      remove: Mock<() => void>;
    },
    canvas,
    renderHandle: null,
    rendered:
      existingRenderScale === null
        ? null
        : { pageIndex: 0, renderScale: existingRenderScale },
    rendering: null,
    pendingRender: null,
  };
}

function createRenderableElement(): TestablePdfElement {
  const element = new PdfElement('pdf-uuid') as unknown as TestablePdfElement;
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

    new PdfElement('pdf-uuid').bindToYMap(yMap);
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

    new PdfElement('pdf-uuid').bindToYMap(yMap);
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

    new PdfElement('pdf-uuid').bindToYMap(yMap);
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

    const element = new PdfElement('pdf-uuid');
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

    const element = new PdfElement('pdf-uuid');
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

    const element = new PdfElement('pdf-uuid');
    element.bindToYMap(yMap);
    await flushPromises();

    vi.mocked(openPdfDocument).mockClear();
    yMap.set('pdfData', new Uint8Array([4, 5, 6]));
    await flushPromises();

    expect(openPdfDocument).not.toHaveBeenCalled();
  });

  it('preserves custom page order with a deleted source page', async () => {
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
    const yMap = createPdfYMap(ydoc, pageSizes, pageOrder, {
      pageOrderCustom: true,
    });
    mockLoadedPdfWithStoredMetadata(pageSizes);

    let localUpdates = 0;
    ydoc.doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) {
        localUpdates += 1;
      }
    });

    new PdfElement('pdf-uuid').bindToYMap(yMap);
    await flushPromises();

    expect(localUpdates).toBe(0);
    expect(yMap.get('pageOrder')).toEqual(pageOrder);
    expect(getPdfDocumentPageSizes).not.toHaveBeenCalled();
  });

  it('hydrates and writes page layout through the Yjs map', async () => {
    const ydoc = new YDocManager();
    const pageSizes = [
      { w: 612, h: 792 },
      { w: 300, h: 150 },
    ];
    const yMap = createPdfYMap(
      ydoc,
      pageSizes,
      pageSizes.map((_, originalIndex) => ({
        kind: 'pdf' as const,
        originalIndex,
      })),
      { pageLayout: 'horizontal' },
    );
    mockLoadedPdfWithStoredMetadata(pageSizes);

    const element = new PdfElement('pdf-uuid');
    element.bindToYMap(yMap);
    await flushPromises();

    expect(element.pageLayout).toBe('horizontal');
    expect(element.totalWidth).toBe(612 + PAGE_GAP + 300);
    expect(element.totalHeight).toBe(792);

    element.setPageLayout('vertical');
    expect(yMap.get('pageLayout')).toBe('vertical');
    expect(element.pageLayout).toBe('vertical');
  });

  it('positions pages side by side in horizontal layout', () => {
    const element = new PdfElement('pdf-uuid');
    const state = element as unknown as TestablePdfLayoutState;
    state._pageSizes = [
      { w: 612, h: 792 },
      { w: 300, h: 150 },
    ];
    state._pageOrder = [
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
    ];
    state._layout = null;

    element.setPageLayout('horizontal');

    const layout = state.getLayout();
    expect(layout.totalWidth).toBe(612 + PAGE_GAP + 300);
    expect(layout.totalHeight).toBe(792);
    expect(layout.pages[0]).toMatchObject({
      localLeft: 0,
      localTop: 0,
    });
    expect(layout.pages[1]).toMatchObject({
      localLeft: 612 + PAGE_GAP,
      localTop: 321,
    });
    expect(element.getYMapProps().pageLayout).toBe('horizontal');
  });

  it('inserts a blank page into the stored page order', async () => {
    const ydoc = new YDocManager();
    const pageSizes = [
      { w: 612, h: 792 },
      { w: 300, h: 150 },
    ];
    const yMap = createPdfYMap(ydoc, pageSizes);
    mockLoadedPdfWithStoredMetadata(pageSizes);

    const element = new PdfElement('pdf-uuid');
    const insertable = element as unknown as TestablePdfInsertion;
    element.bindToYMap(yMap);
    await flushPromises();

    insertable.insertBlankPage(1);

    const expectedPageOrder = [
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'blank', size: { w: 612, h: 792 } },
      { kind: 'pdf', originalIndex: 1 },
    ];
    expect(yMap.get('pageOrder')).toEqual(expectedPageOrder);
    expect(yMap.get('pageOrderCustom')).toBe(true);
    expect(insertable.getYMapProps().pageOrder).toEqual(expectedPageOrder);
    expect(insertable.getYMapProps().pageOrderCustom).toBe(true);
  });

  it('deletes a source page from the stored page order', async () => {
    const ydoc = new YDocManager();
    const pageSizes = [
      { w: 612, h: 792 },
      { w: 300, h: 150 },
      { w: 400, h: 200 },
    ];
    const yMap = createPdfYMap(ydoc, pageSizes);
    mockLoadedPdfWithStoredMetadata(pageSizes);

    const element = new PdfElement('pdf-uuid');
    const editable = element as unknown as TestablePdfInsertion;
    element.bindToYMap(yMap);
    await flushPromises();

    editable.deletePage(1);

    const expectedPageOrder = [
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 2 },
    ];
    expect(yMap.get('pageOrder')).toEqual(expectedPageOrder);
    expect(yMap.get('pageOrderCustom')).toBe(true);
    expect(editable.getYMapProps().pageOrder).toEqual(expectedPageOrder);
    expect(editable.getYMapProps().pageOrderCustom).toBe(true);
  });

  it('preserves rendered canvases when inserting a blank page', () => {
    const element = new PdfElement('pdf-uuid');
    const state = element as unknown as TestablePdfPageDomState;
    state._pageSizes = [
      { w: 612, h: 792 },
      { w: 300, h: 150 },
    ];
    state._pageOrder = [
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
    ];
    state._layout = null;

    const firstPageDom = createPageDom(1, createTestCanvas(612, 792));
    const secondPageDom = createPageDom(1, createTestCanvas(300, 150));
    state._pageDoms = new Map([
      [0, firstPageDom],
      [1, secondPageDom],
    ]);

    state.insertBlankPage(1);

    expect(state._pageDoms.get(0)).toBe(firstPageDom);
    expect(state._pageDoms.get(2)).toBe(secondPageDom);
    expect(firstPageDom.canvas.width).toBe(612);
    expect(firstPageDom.canvas.height).toBe(792);
    expect(secondPageDom.canvas.width).toBe(300);
    expect(secondPageDom.canvas.height).toBe(150);
    expect(firstPageDom.root.remove).not.toHaveBeenCalled();
    expect(secondPageDom.root.remove).not.toHaveBeenCalled();
  });

  it('preserves surviving rendered canvases when deleting a page', () => {
    const element = new PdfElement('pdf-uuid');
    const state = element as unknown as TestablePdfPageDomState;
    state._pageSizes = [
      { w: 612, h: 792 },
      { w: 300, h: 150 },
      { w: 400, h: 200 },
    ];
    state._pageOrder = [
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 2 },
    ];
    state._layout = null;

    const firstPageDom = createPageDom(1, createTestCanvas(612, 792));
    const deletedPageDom = createPageDom(1, createTestCanvas(300, 150));
    const thirdPageDom = createPageDom(1, createTestCanvas(400, 200));
    state._pageDoms = new Map([
      [0, firstPageDom],
      [1, deletedPageDom],
      [2, thirdPageDom],
    ]);

    state.deletePage(1);

    expect(state._pageDoms.get(0)).toBe(firstPageDom);
    expect(state._pageDoms.get(1)).toBe(thirdPageDom);
    expect(firstPageDom.canvas.width).toBe(612);
    expect(firstPageDom.canvas.height).toBe(792);
    expect(thirdPageDom.canvas.width).toBe(400);
    expect(thirdPageDom.canvas.height).toBe(200);
    expect(firstPageDom.root.remove).not.toHaveBeenCalled();
    expect(thirdPageDom.root.remove).not.toHaveBeenCalled();
    expect(deletedPageDom.root.remove).toHaveBeenCalledTimes(1);
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
