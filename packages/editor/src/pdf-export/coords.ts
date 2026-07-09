/**
 * Coordinate helpers for PDF export. krilla uses a top-left origin (y down), so no
 * Y-flip is needed — we only convert CSS px → PDF points and map content-local
 * coordinates to a page index + page-local position.
 */

/** CSS px are treated as 96 DPI; PDF points are 72 DPI. */
export const POINTS_PER_PX = 72 / 96;

export function pxToPt(px: number): number {
  return px * POINTS_PER_PX;
}

export interface PageGeometry {
  pageWidth: number;
  pageHeight: number;
  pageGap: number;
  layout: 'vertical' | 'horizontal';
}

export interface PageLocalPoint {
  pageIndex: number;
  /** Page-local position in CSS px, top-left origin. */
  xPx: number;
  yPx: number;
}

/**
 * Map a point in content-local CSS px (the cloned editor's coordinate space, where
 * page p is stacked along the layout axis) to its page index and page-local px.
 */
export function localToPage(
  localX: number,
  localY: number,
  geom: PageGeometry,
): PageLocalPoint {
  if (geom.layout === 'horizontal') {
    const stride = geom.pageWidth + geom.pageGap;
    const pageIndex = Math.max(0, Math.floor(localX / stride));
    return {
      pageIndex,
      xPx: localX - pageIndex * stride,
      yPx: localY,
    };
  }
  const stride = geom.pageHeight + geom.pageGap;
  const pageIndex = Math.max(0, Math.floor(localY / stride));
  return {
    pageIndex,
    xPx: localX,
    yPx: localY - pageIndex * stride,
  };
}
