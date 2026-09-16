export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function visibleArea(rect: Rect, viewport: Rect): number {
  const width = Math.max(
    0,
    Math.min(rect.left + rect.width, viewport.left + viewport.width) -
      Math.max(rect.left, viewport.left),
  );
  const height = Math.max(
    0,
    Math.min(rect.top + rect.height, viewport.top + viewport.height) -
      Math.max(rect.top, viewport.top),
  );
  return width * height;
}

export function findCurrentPdfPage(
  pageBounds: readonly Rect[],
  viewport: Rect,
): number | null {
  let current: number | null = null;
  let greatestArea = 0;
  for (const [index, bounds] of pageBounds.entries()) {
    const area = visibleArea(bounds, viewport);
    if (area > greatestArea) {
      greatestArea = area;
      current = index;
    }
  }
  if (current !== null) {
    return current;
  }
  let nearest: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  const viewportCenter = {
    x: viewport.left + viewport.width / 2,
    y: viewport.top + viewport.height / 2,
  };
  for (const [index, bounds] of pageBounds.entries()) {
    const distance = Math.hypot(
      bounds.left + bounds.width / 2 - viewportCenter.x,
      bounds.top + bounds.height / 2 - viewportCenter.y,
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  }
  return nearest;
}

export function getPdfPageJumpOffset(params: {
  pageBounds: Rect;
  viewport: Rect;
  zoom: number;
  margin: number;
}): { x: number; y: number } {
  const screenWidth = params.viewport.width * params.zoom;
  const screenHeight = params.viewport.height * params.zoom;
  const pageWidth = params.pageBounds.width * params.zoom;
  const pageHeight = params.pageBounds.height * params.zoom;
  const targetLeft =
    pageWidth <= screenWidth - params.margin * 2
      ? (screenWidth - pageWidth) / 2
      : params.margin;
  const targetTop =
    pageHeight <= screenHeight - params.margin * 2
      ? (screenHeight - pageHeight) / 2
      : params.margin;

  return {
    x: targetLeft / params.zoom - params.pageBounds.left,
    y: targetTop / params.zoom - params.pageBounds.top,
  };
}
