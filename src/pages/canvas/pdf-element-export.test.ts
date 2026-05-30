import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PdfHarvestContext } from '@/lib/pdf-export/harvest';
import {
  buildPdfElementRequest,
  getPdfExportPages,
  getPdfOverlayCandidates,
  type PdfElementExportSource,
  type PdfExportOverlayElement,
} from './pdf-element-export';

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

function overlayElement(
  uuid: string,
  boundingBox: DOMRect,
  hidden = false,
  drawToPdf: (ctx: PdfHarvestContext) => void = () => {},
): PdfExportOverlayElement {
  return { uuid, boundingBox, hidden, drawToPdf };
}

function exportSource(
  overrides: Partial<PdfElementExportSource> = {},
): PdfElementExportSource {
  return {
    uuid: 'pdf-target',
    pdfBytes: new Uint8Array(),
    pages: [
      {
        kind: 'pdf',
        originalIndex: 0,
        size: { w: 100, h: 50 },
        localLeft: 0,
        localTop: 0,
      },
    ],
    offset: { x: 10, y: 20 },
    scale: { x: 2, y: 3 },
    boundingBox: rect(-10, -36, 140, 126),
    ...overrides,
  };
}

describe('PDF export overlay selection', () => {
  it('uses the PDF element bounding box to choose overlay candidates', () => {
    const source = exportSource();
    const insideChrome = overlayElement('a', rect(0, -30, 20, 20));
    const outside = overlayElement('b', rect(200, 200, 20, 20));
    const sameElement = overlayElement('pdf-target', rect(0, 0, 20, 20));
    const hidden = overlayElement('c', rect(0, 0, 20, 20), true);

    expect(
      getPdfOverlayCandidates(source, [
        insideChrome,
        outside,
        sameElement,
        hidden,
      ]),
    ).toEqual([insideChrome]);
  });
});

describe('PDF export page geometry', () => {
  it('maps ordered PDF pages to world-space page bounds', () => {
    const pages = getPdfExportPages(
      exportSource({
        pages: [
          {
            kind: 'pdf',
            originalIndex: 0,
            size: { w: 100, h: 50 },
            localLeft: 0,
            localTop: 0,
          },
          {
            kind: 'pdf',
            originalIndex: 1,
            size: { w: 50, h: 100 },
            localLeft: 25,
            localTop: 60,
          },
        ],
      }),
    );

    expect(pages).toMatchObject([
      {
        originalIndex: 0,
        worldBounds: rect(10, 20, 200, 150),
      },
      {
        originalIndex: 1,
        worldBounds: rect(60, 200, 100, 300),
      },
    ]);
  });
});

describe('buildPdfElementRequest', () => {
  it('emits a pdfElement request with page sizes, pageMap and harvested items in page-pt space', () => {
    // Overlay at world (10,20) maps to page-local (0,0); scale (2,3) → ptPerWorldY 1/3.
    const overlay = overlayElement(
      'ink',
      rect(10, 20, 20, 20),
      false,
      (ctx) => {
        const p = ctx.worldToPagePt(30, 50);
        ctx.push({
          t: 'path',
          pts: [p.x, p.y],
          closed: true,
          fill: [0, 0, 0],
        });
      },
    );

    const request = buildPdfElementRequest(
      exportSource({
        pages: [
          {
            kind: 'pdf',
            originalIndex: 2,
            size: { w: 100, h: 50 },
            localLeft: 0,
            localTop: 0,
          },
          {
            kind: 'blank',
            size: { w: 100, h: 50 },
            localLeft: 0,
            localTop: 60,
          },
        ],
      }),
      [overlay],
    );

    expect(request.kind).toBe('pdfElement');
    expect(request.pageMap).toEqual([2, 'blank']);
    expect(request.pages).toHaveLength(2);
    expect(request.pages[0]).toMatchObject({ widthPt: 100, heightPt: 50 });
    // world (30,50) - origin (10,20) over scale (2,3) → (10, 10).
    expect(request.pages[0].items).toEqual([
      { t: 'path', pts: [10, 10], closed: true, fill: [0, 0, 0] },
    ]);
  });
});
