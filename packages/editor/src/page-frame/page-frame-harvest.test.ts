import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_GAP } from '../elements/page-frame-constants';
import type { PdfExportOverlayElement } from '../pdf-element-export';
import { harvestPageFramePdf } from './page-frame-harvest';

afterEach(() => vi.unstubAllGlobals());

describe('page-frame PDF overlays', () => {
  it('maps world-space annotations onto a group-scaled page frame', async () => {
    const clone = {
      style: {},
      getBoundingClientRect: () => new DOMRect(0, 0, 100, 100),
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
    const container = {
      style: {},
      appendChild: vi.fn(),
      remove: vi.fn(),
    } as unknown as HTMLElement;
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: () => container,
      createTreeWalker: () => ({ nextNode: () => null }),
      fonts: { ready: Promise.resolve() },
    });
    vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });

    const worldY = 50 + (100 + PAGE_GAP) * 2 + 20;
    const overlay: PdfExportOverlayElement = {
      uuid: 'ink',
      hidden: false,
      boundingBox: new DOMRect(120, worldY, 10, 10),
      prepareForPdf: async () => {},
      drawToPdf: (ctx) => {
        const point = ctx.worldToPagePt(120, worldY);
        ctx.push({
          t: 'rect',
          x: point.x,
          y: point.y,
          w: 1,
          h: 1,
          fill: [0, 0, 0],
        });
      },
    };

    const { request } = await harvestPageFramePdf({
      contentDiv: { cloneNode: () => clone } as unknown as HTMLElement,
      numPages: 2,
      pageWidth: 100,
      pageHeight: 100,
      pageLayout: 'vertical',
      scale: { x: 2, y: 2 },
      offset: { x: 100, y: 50 },
      selfUuid: 'frame',
      overlays: [overlay],
    });

    expect(request.pages[0].items).toEqual([]);
    expect(request.pages[1].items).toMatchObject([
      { t: 'rect', x: 7.5, y: 7.5 },
    ]);
  });
});
