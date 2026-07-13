import type { DrawableElement } from './elements/drawable-element';
import type { Vector2 } from './geometry';
import type {
  ExportPage,
  PageItem,
  PageRef,
  PdfExportRequest,
} from './pdf-export/contract';
import { createFontTable, type PdfHarvestContext } from './pdf-export/harvest';
import type { PdfPageSize } from './pdf-renderer';

export interface PdfElementExportSource {
  uuid: string;
  pdfBytes: Uint8Array;
  pages: PdfElementExportPage[];
  offset: Vector2;
  scale: Vector2;
  boundingBox: DOMRect;
}

export interface PdfElementExportPdfPage {
  kind: 'pdf';
  originalIndex: number;
  size: PdfPageSize;
  localLeft: number;
  localTop: number;
}

export interface PdfElementExportBlankPage {
  kind: 'blank';
  size: PdfPageSize;
  localLeft: number;
  localTop: number;
}

export type PdfElementExportPage =
  | PdfElementExportPdfPage
  | PdfElementExportBlankPage;

export type PdfExportPage = PdfElementExportPage & {
  worldBounds: DOMRect;
};

/** Overlay elements draw themselves natively onto the embedded PDF page. */
export type PdfExportOverlayElement = Pick<
  DrawableElement,
  'uuid' | 'boundingBox' | 'hidden' | 'drawToPdf' | 'prepareForPdf'
>;

/**
 * Await every overlay's async PDF preparation (raster bitmaps, etc.) before the
 * synchronous harvest pass — `drawToPdf` can't await, so its inputs must be
 * ready first.
 */
export async function prepareExportOverlays(
  elements: readonly PdfExportOverlayElement[],
): Promise<void> {
  await Promise.all(elements.map((element) => element.prepareForPdf()));
}

export function getPdfOverlayCandidates(
  target: Pick<PdfElementExportSource, 'uuid' | 'boundingBox'>,
  elements: readonly PdfExportOverlayElement[],
): PdfExportOverlayElement[] {
  return elements.filter(
    (element) =>
      element.uuid !== target.uuid &&
      !element.hidden &&
      rectsIntersect(element.boundingBox, target.boundingBox),
  );
}

export function getPdfExportPages(
  target: PdfElementExportSource,
): PdfExportPage[] {
  const scaleX = getPositiveScale(target.scale.x);
  const scaleY = getPositiveScale(target.scale.y);

  return target.pages.map((page) => ({
    ...page,
    worldBounds: new DOMRect(
      target.offset.x + page.localLeft * scaleX,
      target.offset.y + page.localTop * scaleY,
      page.size.w * scaleX,
      page.size.h * scaleY,
    ),
  }));
}

/**
 * Harvest the overlay elements into a display-list request: the original PDF pages
 * are kept (referenced by `pageMap`) and each overlapping element emits native draw
 * commands positioned in that page's PDF-point space. Rust assembles the result.
 */
export function buildPdfElementRequest(
  target: PdfElementExportSource,
  elements: readonly PdfExportOverlayElement[],
): PdfExportRequest {
  const scaleX = getPositiveScale(target.scale.x);
  const scaleY = getPositiveScale(target.scale.y);
  const pages = getPdfExportPages(target);
  const candidates = getPdfOverlayCandidates(target, elements);

  const imagesB64: string[] = [];
  const fontsB64: string[] = [];
  const addFontBase64 = createFontTable(fontsB64);
  const exportPages: ExportPage[] = [];
  const pageMap: PageRef[] = [];

  for (const page of pages) {
    const items: PageItem[] = [];
    const ctx: PdfHarvestContext = {
      ptPerWorldY: 1 / scaleY,
      worldToPagePt: (wx, wy) => ({
        x: (wx - page.worldBounds.x) / scaleX,
        y: (wy - page.worldBounds.y) / scaleY,
      }),
      push: (item) => items.push(item),
      addImageBase64: (b64) => {
        imagesB64.push(b64);
        return imagesB64.length - 1;
      },
      addFontBase64,
    };

    for (const element of candidates) {
      if (rectsIntersect(element.boundingBox, page.worldBounds)) {
        element.drawToPdf(ctx);
      }
    }

    exportPages.push({ widthPt: page.size.w, heightPt: page.size.h, items });
    pageMap.push(page.kind === 'pdf' ? page.originalIndex : 'blank');
  }

  return {
    kind: 'pdfElement',
    pages: exportPages,
    pageMap,
    imagesB64,
    fontsB64,
  };
}

export function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

function getPositiveScale(value: number): number {
  return Math.max(Math.abs(value), 0.001);
}
