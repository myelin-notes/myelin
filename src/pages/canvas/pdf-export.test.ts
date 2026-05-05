import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createPdfExportBytes,
  getPdfExportPages,
  getPdfOverlayCandidates,
  type PdfElementExportSource,
  type PdfExportOverlayElement,
} from './pdf-export';

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
  index: number,
  boundingBox: DOMRect,
  hidden = false,
): PdfExportOverlayElement {
  return {
    index,
    boundingBox,
    hidden,
    draw: vi.fn(),
  };
}

function exportSource(
  overrides: Partial<PdfElementExportSource> = {},
): PdfElementExportSource {
  return {
    index: 10,
    pdfBytes: new Uint8Array(),
    pages: [
      {
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
    const insideChrome = overlayElement(1, rect(0, -30, 20, 20));
    const outside = overlayElement(2, rect(200, 200, 20, 20));
    const sameElement = overlayElement(10, rect(0, 0, 20, 20));
    const hidden = overlayElement(3, rect(0, 0, 20, 20), true);

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
            originalIndex: 0,
            size: { w: 100, h: 50 },
            localLeft: 0,
            localTop: 0,
          },
          {
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
        localLeft: 0,
        localTop: 0,
        worldBounds: rect(10, 20, 200, 150),
      },
      {
        originalIndex: 1,
        localLeft: 25,
        localTop: 60,
        worldBounds: rect(60, 200, 100, 300),
      },
    ]);
  });
});

describe('PDF export bytes', () => {
  it('copies pages in the PDF element page order when no overlays intersect', async () => {
    const sourceDoc = await PDFDocument.create();
    sourceDoc.addPage([200, 100]);
    sourceDoc.addPage([300, 150]);
    const sourceBytes = await sourceDoc.save();

    const exportedBytes = await createPdfExportBytes(
      exportSource({
        pdfBytes: sourceBytes,
        pages: [
          {
            originalIndex: 1,
            size: { w: 300, h: 150 },
            localLeft: 0,
            localTop: 0,
          },
          {
            originalIndex: 0,
            size: { w: 200, h: 100 },
            localLeft: 50,
            localTop: 160,
          },
        ],
      }),
      [],
    );

    const exportedDoc = await PDFDocument.load(exportedBytes);
    const pages = exportedDoc.getPages();

    expect(pages).toHaveLength(2);
    expect(pages[0].getWidth()).toBe(300);
    expect(pages[0].getHeight()).toBe(150);
    expect(pages[1].getWidth()).toBe(200);
    expect(pages[1].getHeight()).toBe(100);
  });
});
