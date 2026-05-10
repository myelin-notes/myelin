import { PDFDocument } from 'pdf-lib';
import { getScratchCanvasContext } from '@/lib/scratch-canvas';
import type { Vector2 } from './drawable-canvas';
import type { DrawableElement } from './elements/drawable-element';
import type { PdfPageSize } from './pdf-renderer';

const OVERLAY_RASTER_SCALE = 2;
const MAX_OVERLAY_PIXELS = 16_000_000;
const MAX_OVERLAY_AXIS_PIXELS = 16_384;

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

export type PdfExportOverlayElement = Pick<
  DrawableElement,
  'uuid' | 'boundingBox' | 'draw' | 'hidden'
>;

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

  return target.pages.map((page) => {
    return {
      ...page,
      worldBounds: new DOMRect(
        target.offset.x + page.localLeft * scaleX,
        target.offset.y + page.localTop * scaleY,
        page.size.w * scaleX,
        page.size.h * scaleY,
      ),
    };
  });
}

export async function createPdfExportBytes(
  target: PdfElementExportSource,
  elements: readonly PdfExportOverlayElement[],
): Promise<Uint8Array> {
  const sourceDoc = await PDFDocument.load(new Uint8Array(target.pdfBytes));
  const outputDoc = await PDFDocument.create();
  const pages = getPdfExportPages(target);
  const pdfPages = pages.filter((page) => page.kind === 'pdf');
  const copiedPages = await outputDoc.copyPages(
    sourceDoc,
    pdfPages.map((page) => page.originalIndex),
  );
  const candidates = getPdfOverlayCandidates(target, elements);
  let copiedPageIndex = 0;

  for (const page of pages) {
    const outputPage =
      page.kind === 'pdf'
        ? copiedPages[copiedPageIndex++]
        : outputDoc.addPage([page.size.w, page.size.h]);

    if (page.kind === 'pdf') {
      outputDoc.addPage(outputPage);
    }

    const pageElements = candidates.filter((element) =>
      rectsIntersect(element.boundingBox, page.worldBounds),
    );
    if (pageElements.length === 0) {
      continue;
    }

    const overlayBytes = await renderPageOverlay(target, page, pageElements);
    const overlayImage = await outputDoc.embedPng(overlayBytes);
    outputPage.drawImage(overlayImage, {
      x: 0,
      y: 0,
      width: outputPage.getWidth(),
      height: outputPage.getHeight(),
    });
  }

  return outputDoc.save();
}

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

function getPositiveScale(value: number): number {
  return Math.max(Math.abs(value), 0.001);
}

function getOverlayRasterScale(size: PdfPageSize): number {
  const maxPixelScale = Math.sqrt(MAX_OVERLAY_PIXELS / (size.w * size.h));
  const maxAxisScale = Math.min(
    MAX_OVERLAY_AXIS_PIXELS / size.w,
    MAX_OVERLAY_AXIS_PIXELS / size.h,
  );
  return Math.min(OVERLAY_RASTER_SCALE, maxPixelScale, maxAxisScale);
}

async function renderPageOverlay(
  target: PdfElementExportSource,
  page: PdfExportPage,
  elements: readonly PdfExportOverlayElement[],
): Promise<Uint8Array> {
  const rasterScale = getOverlayRasterScale(page.size);
  const scratch = getScratchCanvasContext(
    page.size.w * rasterScale,
    page.size.h * rasterScale,
  );

  try {
    const ctx = scratch.context;
    const targetScaleX = getPositiveScale(target.scale.x);
    const targetScaleY = getPositiveScale(target.scale.y);
    ctx.clearRect(0, 0, scratch.width, scratch.height);
    ctx.setTransform(
      rasterScale / targetScaleX,
      0,
      0,
      rasterScale / targetScaleY,
      (-page.worldBounds.x * rasterScale) / targetScaleX,
      (-page.worldBounds.y * rasterScale) / targetScaleY,
    );

    for (const element of elements) {
      element.draw(ctx, 0);
    }

    return await scratch.toBytes({ type: 'image/png' });
  } finally {
    scratch.release();
  }
}
