/**
 * krilla uses a top-left origin (y down), so no Y-flip is needed — this only converts CSS px to
 * PDF points and maps content-local coordinates to a page index + page-local position.
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
}

export interface PageLocalPoint {
  pageIndex: number;
  /** Page-local position in CSS px, top-left origin. */
  xPx: number;
  yPx: number;
}

// Content-local space is the cloned editor's, where page p is stacked downward.
export function localToPage(
  localX: number,
  localY: number,
  geom: PageGeometry,
): PageLocalPoint {
  const stride = geom.pageHeight + geom.pageGap;
  const pageIndex = Math.max(0, Math.floor(localY / stride));
  return {
    pageIndex,
    xPx: localX,
    yPx: localY - pageIndex * stride,
  };
}
