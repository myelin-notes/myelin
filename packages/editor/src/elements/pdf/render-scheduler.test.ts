import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PdfPageRenderScheduler,
  type PdfPageSurface,
} from './render-scheduler';

function createSurface(renderScale: number | null = null): PdfPageSurface {
  return {
    canvas: {
      width: 1,
      height: 1,
      getContext: () => ({ drawImage: vi.fn() }),
    } as unknown as HTMLCanvasElement,
    renderHandle: null,
    rendered: renderScale === null ? null : { pageIndex: 0, renderScale },
    rendering: null,
    pendingRender: null,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PdfPageRenderScheduler', () => {
  it('debounces a replacement render and reuses the staging canvas', async () => {
    vi.useFakeTimers();
    const stagingCanvas = { width: 1, height: 1 } as HTMLCanvasElement;
    const pool = {
      acquire: vi.fn(() => stagingCanvas),
      release: vi.fn(),
      drain: vi.fn(),
    };
    const render = vi.fn(({ canvas, renderScale }) => {
      canvas.width = 100 * renderScale;
      canvas.height = 200 * renderScale;
      return { promise: Promise.resolve(), cancel: vi.fn() };
    });
    const scheduler = new PdfPageRenderScheduler({ canvasPool: pool, render });
    const surface = createSurface(1);
    const visibleCanvas = surface.canvas;
    const drawImage = vi.fn();
    visibleCanvas.width = 100;
    visibleCanvas.height = 200;
    (
      visibleCanvas as unknown as {
        getContext(): CanvasRenderingContext2D;
      }
    ).getContext = () => ({ drawImage }) as unknown as CanvasRenderingContext2D;
    const params = {
      surface,
      document: {} as PDFDocumentProxy,
      pageIndex: 0,
      pageSize: { w: 100, h: 200 },
      renderScale: 1.25,
      zoom: 1.2,
      fastScroll: false,
    };

    scheduler.request(params);
    expect(render).not.toHaveBeenCalled();
    expect(visibleCanvas).toMatchObject({ width: 100, height: 200 });
    vi.advanceTimersByTime(120);
    expect(visibleCanvas).toMatchObject({ width: 100, height: 200 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(render).toHaveBeenCalledOnce();
    expect(pool.acquire).toHaveBeenCalledOnce();
    expect(pool.release).toHaveBeenCalledWith(stagingCanvas);
    expect(surface.rendered).toEqual({ pageIndex: 0, renderScale: 1.25 });
    expect(visibleCanvas).toMatchObject({ width: 125, height: 250 });
    expect(drawImage).toHaveBeenCalledWith(stagingCanvas, 0, 0);
  });

  it('cancels an active render when a page is released', () => {
    const cancel = vi.fn();
    const scheduler = new PdfPageRenderScheduler({
      canvasPool: {
        acquire: vi.fn(),
        release: vi.fn(),
        drain: vi.fn(),
      },
    });
    const surface = createSurface();
    surface.renderHandle = { promise: new Promise(() => {}), cancel };
    surface.rendering = { pageIndex: 0, renderScale: 1 };

    scheduler.release(surface, true);

    expect(cancel).toHaveBeenCalledOnce();
    expect(surface.renderHandle).toBeNull();
    expect(surface.rendered).toBeNull();
  });
});
