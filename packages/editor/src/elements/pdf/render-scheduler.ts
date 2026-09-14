import type { PDFDocumentProxy } from 'pdfjs-dist';
import { CanvasPool } from '../../canvas-pool';
import {
  isPdfRenderCancelled,
  type PdfPageRenderHandle,
  type PdfPageSize,
  renderPdfPageToCanvas,
} from '../../pdf-renderer';

export interface PdfPageRenderKey {
  pageIndex: number;
  renderScale: number;
}

export interface PendingPdfPageRender {
  key: PdfPageRenderKey;
  timeout: number;
  zoom: number;
}

export interface PdfPageSurface {
  canvas: HTMLCanvasElement;
  renderHandle: PdfPageRenderHandle | null;
  rendered: PdfPageRenderKey | null;
  rendering: PdfPageRenderKey | null;
  pendingRender: PendingPdfPageRender | null;
}

export interface PdfCanvasPool {
  acquire(): HTMLCanvasElement;
  release(canvas: HTMLCanvasElement): void;
  drain(): void;
}

export interface PdfRenderSchedulerOptions {
  canvasPool?: PdfCanvasPool;
  render?: (params: {
    document: PDFDocumentProxy;
    pageIndex: number;
    canvas: HTMLCanvasElement;
    renderScale: number;
  }) => PdfPageRenderHandle;
  isCancelled?: (error: unknown) => boolean;
  onError?: (params: {
    error: unknown;
    pageIndex: number;
    pageSize: PdfPageSize;
    renderScale: number;
  }) => void;
}

const PDF_RENDER_DEBOUNCE_MS = 120;

export class PdfPageRenderScheduler {
  private readonly canvasPool: PdfCanvasPool;
  private readonly render: NonNullable<PdfRenderSchedulerOptions['render']>;
  private readonly isCancelled: NonNullable<
    PdfRenderSchedulerOptions['isCancelled']
  >;
  private readonly onError: NonNullable<PdfRenderSchedulerOptions['onError']>;

  public constructor(options: PdfRenderSchedulerOptions = {}) {
    this.canvasPool = options.canvasPool ?? new CanvasPool(2);
    this.render = options.render ?? renderPdfPageToCanvas;
    this.isCancelled = options.isCancelled ?? isPdfRenderCancelled;
    this.onError = options.onError ?? (() => {});
  }

  public request(params: {
    surface: PdfPageSurface;
    document: PDFDocumentProxy | null;
    pageIndex: number;
    pageSize: PdfPageSize;
    renderScale: number;
    zoom: number;
    fastScroll: boolean;
  }): void {
    if (!params.document) {
      return;
    }
    const key = {
      pageIndex: params.pageIndex,
      renderScale: params.renderScale,
    };
    if (
      isSameRenderKey(params.surface.rendered, key) ||
      isSameRenderKey(params.surface.rendering, key)
    ) {
      this.clearPending(params.surface);
      return;
    }
    if (
      params.surface.pendingRender &&
      isSameRenderKey(params.surface.pendingRender.key, key)
    ) {
      if (
        !params.fastScroll &&
        params.surface.pendingRender.zoom === params.zoom
      ) {
        return;
      }
      this.schedule(params);
      return;
    }
    if (
      params.fastScroll ||
      params.surface.rendered?.pageIndex === params.pageIndex
    ) {
      this.schedule(params);
      return;
    }
    this.start(params);
  }

  public release(surface: PdfPageSurface, clearRenderedCanvas: boolean): void {
    this.clearPending(surface);
    surface.renderHandle?.cancel();
    surface.renderHandle = null;
    surface.rendering = null;
    if (!clearRenderedCanvas) {
      return;
    }
    surface.rendered = null;
    if (surface.canvas.width !== 1 || surface.canvas.height !== 1) {
      surface.canvas.width = 1;
      surface.canvas.height = 1;
    }
  }

  public dispose(surfaces: Iterable<PdfPageSurface>): void {
    for (const surface of surfaces) {
      this.release(surface, true);
    }
    this.canvasPool.drain();
  }

  private schedule(params: {
    surface: PdfPageSurface;
    document: PDFDocumentProxy | null;
    pageIndex: number;
    pageSize: PdfPageSize;
    renderScale: number;
    zoom: number;
    fastScroll: boolean;
  }): void {
    this.clearPending(params.surface);
    const key = {
      pageIndex: params.pageIndex,
      renderScale: params.renderScale,
    };
    const timeout = globalThis.setTimeout(() => {
      params.surface.pendingRender = null;
      this.start(params);
    }, PDF_RENDER_DEBOUNCE_MS) as unknown as number;
    params.surface.pendingRender = { key, timeout, zoom: params.zoom };
  }

  private clearPending(surface: PdfPageSurface): void {
    if (surface.pendingRender) {
      globalThis.clearTimeout(surface.pendingRender.timeout);
    }
    surface.pendingRender = null;
  }

  private start(params: {
    surface: PdfPageSurface;
    document: PDFDocumentProxy | null;
    pageIndex: number;
    pageSize: PdfPageSize;
    renderScale: number;
    zoom: number;
    fastScroll: boolean;
  }): void {
    if (!params.document) {
      return;
    }
    params.surface.renderHandle?.cancel();
    params.surface.rendering = {
      pageIndex: params.pageIndex,
      renderScale: params.renderScale,
    };
    const stagingCanvas = this.canvasPool.acquire();
    const handle = this.render({
      document: params.document,
      pageIndex: params.pageIndex,
      canvas: stagingCanvas,
      renderScale: params.renderScale,
    });
    params.surface.renderHandle = handle;

    void handle.promise
      .then(() => {
        if (params.surface.renderHandle !== handle) {
          return;
        }
        const context = params.surface.canvas.getContext('2d');
        if (!context) {
          throw new Error('Failed to create PDF page canvas context');
        }
        params.surface.canvas.width = stagingCanvas.width;
        params.surface.canvas.height = stagingCanvas.height;
        context.drawImage(stagingCanvas, 0, 0);
        params.surface.renderHandle = null;
        params.surface.rendered = {
          pageIndex: params.pageIndex,
          renderScale: params.renderScale,
        };
        params.surface.rendering = null;
      })
      .catch((error) => {
        if (this.isCancelled(error) || params.surface.renderHandle !== handle) {
          return;
        }
        params.surface.renderHandle = null;
        params.surface.rendering = null;
        this.onError({
          error,
          pageIndex: params.pageIndex,
          pageSize: params.pageSize,
          renderScale: params.renderScale,
        });
      })
      .finally(() => {
        this.canvasPool.release(stagingCanvas);
      });
  }
}

function isSameRenderKey(
  left: PdfPageRenderKey | null,
  right: PdfPageRenderKey,
): boolean {
  return (
    left !== null &&
    left.pageIndex === right.pageIndex &&
    left.renderScale === right.renderScale
  );
}
