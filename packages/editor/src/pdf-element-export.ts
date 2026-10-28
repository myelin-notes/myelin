import type { PageAnchor } from './elements/anchorable-element';
import type { DrawableElement } from './elements/drawable-element';
import { getPdfPageKey } from './elements/pdf/layout';
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
  id?: string;
  size: PdfPageSize;
  localLeft: number;
  localTop: number;
}

export type PdfElementExportPage =
  | PdfElementExportPdfPage
  | PdfElementExportBlankPage;

export type PdfExportPage = PdfElementExportPage & {
  worldBounds: DOMRect;
  /** `worldBounds` grown to fit every element anchored to the page; the same object if none sticks out. */
  exportBounds: DOMRect;
};

/** Overlay elements draw themselves natively onto the embedded PDF page. */
export type PdfExportOverlayElement = Pick<
  DrawableElement,
  'uuid' | 'boundingBox' | 'hidden' | 'drawToPdf' | 'prepareForPdf'
> & { pageAnchor?: PageAnchor | null };

// `drawToPdf` can't await, so every overlay's async preparation (raster bitmaps, etc.) must be
// done before the synchronous harvest pass.
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
      (element.pageAnchor?.frameId === target.uuid ||
        rectsIntersect(element.boundingBox, target.boundingBox)),
  );
}

export function getPdfExportPages(
  target: PdfElementExportSource,
  elements: readonly PdfExportOverlayElement[] = [],
): PdfExportPage[] {
  const scaleX = getPositiveScale(target.scale.x);
  const scaleY = getPositiveScale(target.scale.y);

  return target.pages.map((page) => {
    const worldBounds = new DOMRect(
      target.offset.x + page.localLeft * scaleX,
      target.offset.y + page.localTop * scaleY,
      page.size.w * scaleX,
      page.size.h * scaleY,
    );
    const key = getPdfPageKey(page);
    let { left, top, right, bottom } = worldBounds;
    for (const element of elements) {
      const anchor = element.pageAnchor;
      if (
        element.hidden ||
        anchor?.kind !== 'pdf' ||
        anchor.frameId !== target.uuid ||
        anchor.page !== key
      ) {
        continue;
      }
      const box = element.boundingBox;
      left = Math.min(left, box.left);
      top = Math.min(top, box.top);
      right = Math.max(right, box.right);
      bottom = Math.max(bottom, box.bottom);
    }
    const grown =
      left < worldBounds.left ||
      top < worldBounds.top ||
      right > worldBounds.right ||
      bottom > worldBounds.bottom;
    return {
      ...page,
      worldBounds,
      exportBounds: grown
        ? new DOMRect(left, top, right - left, bottom - top)
        : worldBounds,
    };
  });
}

// The original PDF pages are kept (referenced by `pageMap`) and each overlapping element emits
// native draw commands positioned in that page's PDF-point space. A page grown to fit its anchored
// elements places the original at `background`. Rust assembles the result.
export function buildPdfElementRequest(
  target: PdfElementExportSource,
  elements: readonly PdfExportOverlayElement[],
): PdfExportRequest {
  const scaleX = getPositiveScale(target.scale.x);
  const scaleY = getPositiveScale(target.scale.y);
  const candidates = getPdfOverlayCandidates(target, elements);
  const pages = getPdfExportPages(target, candidates);

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
        x: (wx - page.exportBounds.x) / scaleX,
        y: (wy - page.exportBounds.y) / scaleY,
      }),
      push: (item) => items.push(item),
      addImageBase64: (b64) => {
        imagesB64.push(b64);
        return imagesB64.length - 1;
      },
      addFontBase64,
    };

    for (const element of candidates) {
      if (rectsIntersect(element.boundingBox, page.exportBounds)) {
        element.drawToPdf(ctx);
      }
    }

    const extended = page.exportBounds !== page.worldBounds;
    exportPages.push({
      widthPt: extended ? page.exportBounds.width / scaleX : page.size.w,
      heightPt: extended ? page.exportBounds.height / scaleY : page.size.h,
      items,
      ...(extended
        ? {
            background: {
              x: (page.worldBounds.x - page.exportBounds.x) / scaleX,
              y: (page.worldBounds.y - page.exportBounds.y) / scaleY,
              w: page.size.w,
              h: page.size.h,
            },
          }
        : {}),
    });
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
