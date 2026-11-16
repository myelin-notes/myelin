import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_GAP } from '../elements/page-frame-constants';
import type { PdfExportOverlayElement } from '../pdf-element-export';
import { harvestPageFramePdf } from './page-frame-harvest';

const toPng = vi.hoisted(() => vi.fn());
vi.mock('html-to-image', () => ({
  toPng,
  getFontEmbedCSS: vi.fn(async () => ''),
}));

afterEach(() => vi.unstubAllGlobals());

function stubHarvestDom(
  rasterized: readonly HTMLElement[],
  textParent: { closest: (selector: string) => unknown },
) {
  let acceptNode: ((node: unknown) => number) | undefined;
  const clone = {
    style: {},
    getBoundingClientRect: () => new DOMRect(0, 0, 100, 100),
    querySelectorAll: (selector: string) =>
      selector.includes('.pm-math-inline') ? rasterized : [],
  } as unknown as HTMLElement;
  vi.stubGlobal('document', {
    body: { appendChild: vi.fn() },
    createElement: () => ({
      style: {},
      appendChild: vi.fn(),
      remove: vi.fn(),
    }),
    createTreeWalker: (
      _root: unknown,
      _show: unknown,
      filter: { acceptNode: (node: unknown) => number },
    ) => {
      acceptNode = filter.acceptNode;
      return { nextNode: () => null };
    },
    fonts: { ready: Promise.resolve() },
  });
  vi.stubGlobal('NodeFilter', {
    SHOW_TEXT: 4,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  return {
    clone,
    accepts: () =>
      acceptNode?.({ parentElement: textParent, textContent: 'x' }) === 1,
  };
}

function rasterTarget(top: number): HTMLElement {
  return {
    style: {},
    getBoundingClientRect: () => new DOMRect(10, top, 40, 20),
    querySelector: () => null,
  } as unknown as HTMLElement;
}

describe('page-frame PDF rasterized blocks', () => {
  const source = (clone: HTMLElement) => ({
    contentDiv: {
      cloneNode: () => clone,
      querySelectorAll: () => [],
    } as unknown as HTMLElement,
    numPages: 1,
    pageWidth: 100,
    pageHeight: 100,
    pageMargin: 10,
    showPageNumbers: false,
    offset: { x: 0, y: 0 },
    selfUuid: 'frame',
  });

  it('draws math as an image instead of harvesting its glyphs as text', async () => {
    toPng.mockResolvedValueOnce('data:image/png;base64,AAAA');
    const target = rasterTarget(5);
    const { clone, accepts } = stubHarvestDom([target], {
      closest: (selector) => selector.includes('.pm-math-inline'),
    });

    const { request, warnings } = await harvestPageFramePdf(source(clone));

    expect(accepts()).toBe(false);
    // Inline math is `display: inline`, whose clientWidth html-to-image would read as 0.
    expect(toPng).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ width: 40, height: 20 }),
    );
    expect(request.imagesB64).toEqual(['AAAA']);
    expect(request.pages[0].items).toMatchObject([{ t: 'image', imageRef: 0 }]);
    expect(warnings).toEqual([]);
  });

  it('warns rather than silently dropping a block that fails to render', async () => {
    toPng.mockRejectedValueOnce(new Error('tainted canvas'));
    const { clone } = stubHarvestDom([rasterTarget(5)], {
      closest: () => null,
    });

    const { request, warnings } = await harvestPageFramePdf(source(clone));

    expect(request.pages[0].items).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});

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
      contentDiv: {
        cloneNode: () => clone,
        querySelectorAll: () => [],
      } as unknown as HTMLElement,
      numPages: 2,
      pageWidth: 100,
      pageHeight: 100,
      pageMargin: 10,
      showPageNumbers: false,
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
