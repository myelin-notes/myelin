import type { PdfElementExportPage } from '../../pdf-element-export';
import type { PdfPageOrderEntry, PdfPageSize } from '../../pdf-renderer';
import { PAGE_GAP, type PageLayout } from '../page-frame-constants';

export const PDF_PAGE_RENDER_MARGIN = PAGE_GAP * 2;

export interface PdfLayout {
  pages: PdfElementExportPage[];
  totalWidth: number;
  totalHeight: number;
}

export interface PdfRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export function buildPdfLayout(params: {
  pageSizes: readonly PdfPageSize[];
  pageOrder: readonly PdfPageOrderEntry[];
  pageLayout: PageLayout;
  defaultPageSize: PdfPageSize;
}): PdfLayout {
  const pages: PdfElementExportPage[] = [];
  let totalWidth = 0;
  let totalHeight = 0;
  const horizontal = params.pageLayout === 'horizontal';

  for (const entry of params.pageOrder) {
    if (pages.length > 0) {
      if (horizontal) {
        totalWidth += PAGE_GAP;
      } else {
        totalHeight += PAGE_GAP;
      }
    }
    const size =
      entry.kind === 'blank'
        ? entry.size
        : (params.pageSizes[entry.originalIndex] ?? params.defaultPageSize);
    pages.push(
      entry.kind === 'pdf'
        ? {
            kind: 'pdf',
            originalIndex: entry.originalIndex,
            size,
            localLeft: horizontal ? totalWidth : 0,
            localTop: horizontal ? 0 : totalHeight,
          }
        : {
            kind: 'blank',
            size,
            localLeft: horizontal ? totalWidth : 0,
            localTop: horizontal ? 0 : totalHeight,
          },
    );
    if (horizontal) {
      totalWidth += size.w;
      totalHeight = Math.max(totalHeight, size.h);
    } else {
      totalWidth = Math.max(totalWidth, size.w);
      totalHeight += size.h;
    }
  }

  for (const page of pages) {
    if (horizontal) {
      page.localTop = (totalHeight - page.size.h) / 2;
    } else {
      page.localLeft = (totalWidth - page.size.w) / 2;
    }
  }

  return { pages, totalWidth, totalHeight };
}

export function isPdfLayoutVisible(params: {
  worldRect: PdfRect;
  offset: { x: number; y: number };
  scaleX: number;
  scaleY: number;
  layout: PdfLayout;
}): boolean {
  const left = params.offset.x;
  const right = left + params.layout.totalWidth * params.scaleX;
  const top = params.offset.y;
  const bottom = top + params.layout.totalHeight * params.scaleY;
  return (
    right >= params.worldRect.left &&
    left <= params.worldRect.right &&
    bottom >= params.worldRect.top &&
    top <= params.worldRect.bottom
  );
}

export function getPdfVisiblePageRange(params: {
  worldRect: PdfRect;
  offset: { x: number; y: number };
  scaleX: number;
  scaleY: number;
  margin: number;
  pageLayout: PageLayout;
  layout: PdfLayout;
}): { start: number; end: number } {
  const horizontal = params.pageLayout === 'horizontal';
  const localStart = horizontal
    ? (params.worldRect.left - params.margin - params.offset.x) / params.scaleX
    : (params.worldRect.top - params.margin - params.offset.y) / params.scaleY;
  const localEnd = horizontal
    ? (params.worldRect.right + params.margin - params.offset.x) / params.scaleX
    : (params.worldRect.bottom + params.margin - params.offset.y) /
      params.scaleY;

  return {
    start: findFirstPageEndingAtOrAfter(params.layout, localStart, horizontal),
    end: findFirstPageStartingAfter(params.layout, localEnd, horizontal),
  };
}

export function isPdfPageVisible(params: {
  worldRect: PdfRect;
  offset: { x: number; y: number };
  localLeft: number;
  localTop: number;
  pageSize: PdfPageSize;
  scaleX: number;
  scaleY: number;
  verticalMargin: number;
}): boolean {
  const left = params.offset.x + params.localLeft * params.scaleX;
  const top = params.offset.y + params.localTop * params.scaleY;
  const right = left + params.pageSize.w * params.scaleX;
  const bottom = top + params.pageSize.h * params.scaleY;
  return (
    right >= params.worldRect.left &&
    left <= params.worldRect.right &&
    bottom >= params.worldRect.top - params.verticalMargin &&
    top <= params.worldRect.bottom + params.verticalMargin
  );
}

function findFirstPageEndingAtOrAfter(
  layout: PdfLayout,
  localPosition: number,
  horizontal: boolean,
): number {
  let low = 0;
  let high = layout.pages.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const page = layout.pages[mid];
    const end = horizontal
      ? page.localLeft + page.size.w
      : page.localTop + page.size.h;
    if (end < localPosition) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function findFirstPageStartingAfter(
  layout: PdfLayout,
  localPosition: number,
  horizontal: boolean,
): number {
  let low = 0;
  let high = layout.pages.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const page = layout.pages[mid];
    const start = horizontal ? page.localLeft : page.localTop;
    if (start <= localPosition) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
