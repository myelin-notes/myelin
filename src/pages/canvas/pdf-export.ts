import { PDFDocument } from 'pdf-lib';
import type { Vector2 } from './drawable-canvas';
import type { DrawableElement } from './elements/drawable-element';
import type { PdfPageOrderEntry, PdfPageSize } from './pdf-renderer';

const OVERLAY_RASTER_SCALE = 2;
const MAX_OVERLAY_PIXELS = 16_000_000;
const MAX_OVERLAY_AXIS_PIXELS = 16_384;

export interface PdfElementExportSource {
  index: number;
  pdfBytes: Uint8Array;
  pageSizes: PdfPageSize[];
  pageOrder: PdfPageOrderEntry[];
  pageTops: number[];
  totalWidth: number;
  offset: Vector2;
  scale: Vector2;
  boundingBox: DOMRect;
}

export interface PdfExportPage {
  orderIndex: number;
  originalIndex: number;
  size: PdfPageSize;
  localLeft: number;
  localTop: number;
  worldBounds: DOMRect;
}

export type PdfExportOverlayElement = Pick<
  DrawableElement,
  'index' | 'boundingBox' | 'draw' | 'hidden'
>;

export function getPdfOverlayCandidates(
  target: Pick<PdfElementExportSource, 'index' | 'boundingBox'>,
  elements: readonly PdfExportOverlayElement[],
): PdfExportOverlayElement[] {
  return elements.filter(
    (element) =>
      element.index !== target.index &&
      !element.hidden &&
      rectsIntersect(element.boundingBox, target.boundingBox),
  );
}

export function getPdfExportPages(
  target: PdfElementExportSource,
): PdfExportPage[] {
  const scaleX = getPositiveScale(target.scale.x);
  const scaleY = getPositiveScale(target.scale.y);

  return target.pageOrder.map((entry, orderIndex) => {
    const size = target.pageSizes[entry.originalIndex];
    const localLeft = (target.totalWidth - size.w) / 2;
    const localTop = target.pageTops[orderIndex] ?? 0;

    return {
      orderIndex,
      originalIndex: entry.originalIndex,
      size,
      localLeft,
      localTop,
      worldBounds: new DOMRect(
        target.offset.x + localLeft * scaleX,
        target.offset.y + localTop * scaleY,
        size.w * scaleX,
        size.h * scaleY,
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
  const copiedPages = await outputDoc.copyPages(
    sourceDoc,
    pages.map((page) => page.originalIndex),
  );
  const candidates = getPdfOverlayCandidates(target, elements);

  for (const page of pages) {
    const outputPage = copiedPages[page.orderIndex];
    outputDoc.addPage(outputPage);

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
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(page.size.w * rasterScale));
  canvas.height = Math.max(1, Math.ceil(page.size.h * rasterScale));

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    throw new Error('Could not create PDF export canvas');
  }

  const targetScaleX = getPositiveScale(target.scale.x);
  const targetScaleY = getPositiveScale(target.scale.y);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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

  return canvasToPngBytes(canvas);
}

async function canvasToPngBytes(
  canvas: HTMLCanvasElement,
): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error('Could not encode PDF export overlay'));
      }
    }, 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}
