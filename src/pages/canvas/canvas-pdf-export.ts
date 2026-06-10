import { save } from '@tauri-apps/plugin-dialog';
import { bytesToBase64, exportPdf } from '@/lib/pdf-export/client';
import type {
  ExportPage,
  PageItem,
  PdfExportRequest,
} from '@/lib/pdf-export/contract';
import { POINTS_PER_PX, pxToPt } from '@/lib/pdf-export/coords';
import type { PdfHarvestContext } from '@/lib/pdf-export/harvest';
import type { DrawableCanvas } from './drawable-canvas';
import type { DrawableElement } from './elements/drawable-element';
import { PAGE_GAP } from './elements/page-frame-constants';
import { PageFrameElement } from './elements/page-frame-element';
import { PdfElement } from './elements/pdf-element';
import type { ExportResult, ExportTarget } from './export/export-controller';
import {
  harvestPageFramePdf,
  type PageFramePdfSource,
} from './page-frame/page-frame-harvest';
import {
  type PdfElementExportSource,
  prepareExportOverlays,
  rectsIntersect,
} from './pdf-element-export';

const WHITE: [number, number, number] = [255, 255, 255];

export interface CanvasPdfHarvestResult {
  request: PdfExportRequest;
  warnings: string[];
}

export function buildCanvasPdfExportTarget(
  canvas: DrawableCanvas,
  title: string,
): ExportTarget {
  return {
    title,
    formats: ['pdf'],
    supportsAnnotations: false,
    run: () => runCanvasPdfExport(canvas, title),
  };
}

export async function runCanvasPdfExport(
  canvas: DrawableCanvas,
  title: string,
): Promise<ExportResult> {
  const visible = canvas.elements.filter((element) => !element.hidden);
  if (!getCanvasPdfExportBounds(visible)) {
    throw new Error('Canvas has no visible content to export.');
  }

  const path = await save({
    defaultPath: `${getSafeExportName(title)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!path) {
    return { cancelled: true };
  }

  const { request, warnings } = await harvestCanvasPdf(visible);
  await exportPdf(request, path);
  return { warnings };
}

export async function harvestCanvasPdf(
  elements: readonly DrawableElement[],
): Promise<CanvasPdfHarvestResult> {
  const visible = elements.filter((element) => !element.hidden);
  const bounds = getCanvasPdfExportBounds(visible);
  if (!bounds) {
    throw new Error('Canvas has no visible content to export.');
  }

  await prepareExportOverlays(visible);

  const imagesB64: string[] = [];
  const pdfsB64: string[] = [];
  const page: ExportPage = {
    widthPt: pxToPt(bounds.width),
    heightPt: pxToPt(bounds.height),
    items: [],
  };
  const warnings: string[] = [];
  const ctx = createCanvasHarvestContext(page, imagesB64, bounds);

  for (const element of visible) {
    if (element instanceof PageFrameElement) {
      const source = element.getPdfExportSource();
      if (!source) {
        warnings.push('A page frame could not be rendered and was omitted.');
        continue;
      }
      const result = await harvestPageFramePdf(source);
      appendPageFrameHarvest(page, imagesB64, result.request, source, bounds);
      warnings.push(...result.warnings);
      continue;
    }

    if (element instanceof PdfElement) {
      const source = element.getPdfExportSource();
      if (!source) {
        warnings.push('A PDF could not be rendered and was omitted.');
        continue;
      }
      appendPdfElementSource(page, pdfsB64, source, bounds);
      continue;
    }

    if (rectsIntersect(element.boundingBox, bounds)) {
      element.drawToPdf(ctx);
    }
  }

  return {
    request: { kind: 'canvas', pages: [page], imagesB64, pdfsB64 },
    warnings,
  };
}

export function getCanvasPdfExportBounds(
  elements: readonly DrawableElement[],
): DOMRect | null {
  const boxes = elements.flatMap((element) => {
    const box = getElementPdfExportBounds(element);
    return box && (box.width > 0 || box.height > 0) ? [box] : [];
  });
  if (boxes.length === 0) {
    return null;
  }
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

function getElementPdfExportBounds(element: DrawableElement): DOMRect | null {
  if (element.hidden) {
    return null;
  }
  if (element instanceof PageFrameElement) {
    const source = element.getPdfExportSource();
    return source
      ? getPageFrameContentBounds(source)
      : scaledContentBounds(element, element.totalWidth, element.totalHeight);
  }
  if (element instanceof PdfElement) {
    const source = element.getPdfExportSource();
    return source ? getPdfElementContentBounds(source) : null;
  }
  return element.boundingBox;
}

function scaledContentBounds(
  element: DrawableElement,
  width: number,
  height: number,
): DOMRect {
  const scaleX = getPositiveScale(element.scale.x);
  const scaleY = getPositiveScale(element.scale.y);
  return new DOMRect(
    element.offset.x,
    element.offset.y,
    width * scaleX,
    height * scaleY,
  );
}

function getPdfElementContentBounds(source: PdfElementExportSource): DOMRect {
  const scaleX = getPositiveScale(source.scale.x);
  const scaleY = getPositiveScale(source.scale.y);
  const right = Math.max(
    0,
    ...source.pages.map((page) => page.localLeft + page.size.w),
  );
  const bottom = Math.max(
    0,
    ...source.pages.map((page) => page.localTop + page.size.h),
  );
  return new DOMRect(
    source.offset.x,
    source.offset.y,
    right * scaleX,
    bottom * scaleY,
  );
}

function getPageFrameContentBounds(source: PageFramePdfSource): DOMRect {
  const scaleX = getPositiveScale(source.scale?.x ?? 1);
  const scaleY = getPositiveScale(source.scale?.y ?? 1);
  const horizontal = source.pageLayout === 'horizontal';
  const width = horizontal
    ? source.numPages * source.pageWidth +
      Math.max(0, source.numPages - 1) * PAGE_GAP
    : source.pageWidth;
  const height = horizontal
    ? source.pageHeight
    : source.numPages * source.pageHeight +
      Math.max(0, source.numPages - 1) * PAGE_GAP;

  return new DOMRect(
    source.offset.x,
    source.offset.y,
    width * scaleX,
    height * scaleY,
  );
}

function createCanvasHarvestContext(
  page: ExportPage,
  imagesB64: string[],
  bounds: DOMRect,
): PdfHarvestContext {
  return {
    ptPerWorldY: POINTS_PER_PX,
    worldToPagePt: (wx, wy) => ({
      x: pxToPt(wx - bounds.x),
      y: pxToPt(wy - bounds.y),
    }),
    push: (item) => page.items.push(item),
    addImageBase64: (b64) => imagesB64.push(b64) - 1,
  };
}

function appendPageFrameHarvest(
  target: ExportPage,
  imagesB64: string[],
  request: PdfExportRequest,
  source: PageFramePdfSource,
  canvasBounds: DOMRect,
): void {
  const imageRefOffset = imagesB64.length;
  imagesB64.push(...(request.imagesB64 ?? []));

  const scaleX = getPositiveScale(source.scale?.x ?? 1);
  const scaleY = getPositiveScale(source.scale?.y ?? 1);
  const horizontal = source.pageLayout === 'horizontal';

  for (let pageIndex = 0; pageIndex < request.pages.length; pageIndex++) {
    const harvestedPage = request.pages[pageIndex];
    const localX = horizontal ? pageIndex * (source.pageWidth + PAGE_GAP) : 0;
    const localY = horizontal ? 0 : pageIndex * (source.pageHeight + PAGE_GAP);
    const worldX = source.offset.x + localX * scaleX;
    const worldY = source.offset.y + localY * scaleY;
    const origin = {
      x: pxToPt(worldX - canvasBounds.x),
      y: pxToPt(worldY - canvasBounds.y),
    };

    target.items.push({
      t: 'rect',
      x: origin.x,
      y: origin.y,
      w: harvestedPage.widthPt * scaleX,
      h: harvestedPage.heightPt * scaleY,
      fill: WHITE,
    });

    for (const item of harvestedPage.items) {
      target.items.push(
        transformPageItem(item, origin, scaleX, scaleY, imageRefOffset),
      );
    }
  }
}

function appendPdfElementSource(
  page: ExportPage,
  pdfsB64: string[],
  source: PdfElementExportSource,
  canvasBounds: DOMRect,
): void {
  const pdfRef = pdfsB64.push(bytesToBase64(source.pdfBytes)) - 1;
  const scaleX = getPositiveScale(source.scale.x);
  const scaleY = getPositiveScale(source.scale.y);

  for (const pdfPage of source.pages) {
    const x = pxToPt(
      source.offset.x + pdfPage.localLeft * scaleX - canvasBounds.x,
    );
    const y = pxToPt(
      source.offset.y + pdfPage.localTop * scaleY - canvasBounds.y,
    );
    const w = pxToPt(pdfPage.size.w * scaleX);
    const h = pxToPt(pdfPage.size.h * scaleY);

    page.items.push({ t: 'rect', x, y, w, h, fill: WHITE });
    if (pdfPage.kind === 'pdf') {
      page.items.push({
        t: 'pdfPage',
        x,
        y,
        w,
        h,
        pdfRef,
        pageIndex: pdfPage.originalIndex,
      });
    }
  }
}

function transformPageItem(
  item: PageItem,
  origin: { x: number; y: number },
  scaleX: number,
  scaleY: number,
  imageRefOffset: number,
): PageItem {
  switch (item.t) {
    case 'text':
      return {
        ...item,
        x: origin.x + item.x * scaleX,
        baselineY: origin.y + item.baselineY * scaleY,
        sizePt: item.sizePt * scaleY,
      };
    case 'rect':
      return {
        ...item,
        x: origin.x + item.x * scaleX,
        y: origin.y + item.y * scaleY,
        w: item.w * scaleX,
        h: item.h * scaleY,
        lineWidth: item.lineWidth ? item.lineWidth * scaleY : item.lineWidth,
      };
    case 'line':
      return {
        ...item,
        x1: origin.x + item.x1 * scaleX,
        y1: origin.y + item.y1 * scaleY,
        x2: origin.x + item.x2 * scaleX,
        y2: origin.y + item.y2 * scaleY,
        width: item.width * scaleY,
      };
    case 'path':
      return {
        ...item,
        pts: item.pts.map((value, index) =>
          index % 2 === 0
            ? origin.x + value * scaleX
            : origin.y + value * scaleY,
        ),
      };
    case 'image':
      return {
        ...item,
        x: origin.x + item.x * scaleX,
        y: origin.y + item.y * scaleY,
        w: item.w * scaleX,
        h: item.h * scaleY,
        imageRef: item.imageRef + imageRefOffset,
      };
    case 'pdfPage':
      return {
        ...item,
        x: origin.x + item.x * scaleX,
        y: origin.y + item.y * scaleY,
        w: item.w * scaleX,
        h: item.h * scaleY,
      };
  }
}

function getSafeExportName(title: string): string {
  return (
    [...title]
      .map((char) =>
        char.charCodeAt(0) <= 0x1f || '/\\:*?"<>|'.includes(char) ? '-' : char,
      )
      .join('')
      .trim() || 'Canvas'
  );
}

function getPositiveScale(value: number): number {
  return Math.max(Math.abs(value), 0.001);
}
