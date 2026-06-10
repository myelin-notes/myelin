import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pxToPt } from '@/lib/pdf-export/coords';
import type { PdfHarvestContext } from '@/lib/pdf-export/harvest';
import {
  getCanvasPdfExportBounds,
  harvestCanvasPdf,
} from './canvas-pdf-export';
import type { DrawableElement } from './elements/drawable-element';
import { PdfElement } from './elements/pdf-element';
import type { PdfElementExportSource } from './pdf-element-export';

class TestDOMRect {
  public constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
  ) {}
  public get left(): number {
    return this.x;
  }
  public get right(): number {
    return this.x + this.width;
  }
  public get top(): number {
    return this.y;
  }
  public get bottom(): number {
    return this.y + this.height;
  }
}

beforeAll(() => {
  if (!globalThis.DOMRect) {
    vi.stubGlobal('DOMRect', TestDOMRect);
  }
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return new DOMRect(x, y, width, height);
}

let nextUuid = 0;

function drawableElement(options: {
  boundingBox: DOMRect;
  hidden?: boolean;
  drawToPdf?: (ctx: PdfHarvestContext) => void;
}): DrawableElement {
  return {
    uuid: `element-${nextUuid++}`,
    hidden: options.hidden ?? false,
    offset: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    boundingBox: options.boundingBox,
    prepareForPdf: () => Promise.resolve(),
    drawToPdf: options.drawToPdf ?? (() => {}),
  } as unknown as DrawableElement;
}

describe('canvas PDF export bounds', () => {
  it('unions visible element export bounds and skips hidden elements', () => {
    const bounds = getCanvasPdfExportBounds([
      drawableElement({ boundingBox: rect(10, 20, 30, 40) }),
      drawableElement({ boundingBox: rect(0, 0, 100, 100), hidden: true }),
      drawableElement({ boundingBox: rect(50, 80, 10, 20) }),
    ]);

    expect(bounds).toMatchObject(rect(10, 20, 50, 80));
  });
});

describe('harvestCanvasPdf', () => {
  it('maps ordinary canvas elements into a single canvas PDF page', async () => {
    const element = drawableElement({
      boundingBox: rect(10, 20, 30, 40),
      drawToPdf: (ctx) => {
        const p = ctx.worldToPagePt(25, 50);
        ctx.push({
          t: 'path',
          pts: [p.x, p.y, p.x + 1, p.y + 1],
          closed: false,
          stroke: [0, 0, 0],
        });
      },
    });

    const { request } = await harvestCanvasPdf([element]);

    expect(request.kind).toBe('canvas');
    expect(request.pages).toHaveLength(1);
    expect(request.pages[0]).toMatchObject({
      widthPt: pxToPt(30),
      heightPt: pxToPt(40),
    });
    expect(request.pages[0].items).toEqual([
      {
        t: 'path',
        pts: [pxToPt(15), pxToPt(30), pxToPt(15) + 1, pxToPt(30) + 1],
        closed: false,
        stroke: [0, 0, 0],
      },
    ]);
  });

  it('places imported PDF pages by reference instead of rasterizing them', async () => {
    const source: PdfElementExportSource = {
      uuid: 'pdf',
      pdfBytes: new Uint8Array([1, 2, 3]),
      offset: { x: 5, y: 6 },
      scale: { x: 2, y: 1 },
      boundingBox: rect(0, 0, 1, 1),
      pages: [
        {
          kind: 'pdf',
          originalIndex: 3,
          size: { w: 100, h: 50 },
          localLeft: 10,
          localTop: 20,
        },
        {
          kind: 'blank',
          size: { w: 20, h: 10 },
          localLeft: 0,
          localTop: 80,
        },
      ],
    };
    const pdf = Object.create(PdfElement.prototype) as PdfElement;
    pdf.getPdfExportSource = () => source;

    const { request } = await harvestCanvasPdf([
      pdf as unknown as DrawableElement,
    ]);

    expect(request.pdfsB64).toEqual(['AQID']);
    expect(request.pages[0]).toMatchObject({
      widthPt: pxToPt(220),
      heightPt: pxToPt(90),
    });
    expect(request.pages[0].items).toEqual([
      {
        t: 'rect',
        x: pxToPt(20),
        y: pxToPt(20),
        w: pxToPt(200),
        h: pxToPt(50),
        fill: [255, 255, 255],
      },
      {
        t: 'pdfPage',
        x: pxToPt(20),
        y: pxToPt(20),
        w: pxToPt(200),
        h: pxToPt(50),
        pdfRef: 0,
        pageIndex: 3,
      },
      {
        t: 'rect',
        x: 0,
        y: pxToPt(80),
        w: pxToPt(40),
        h: pxToPt(10),
        fill: [255, 255, 255],
      },
    ]);
  });

  it('rejects empty canvas exports', async () => {
    await expect(harvestCanvasPdf([])).rejects.toThrow(
      'Canvas has no visible content to export.',
    );
  });
});
