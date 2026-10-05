export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SelectionToolbarPositionParams {
  selectionBounds: Rect;
  viewport: Rect;
  toolbarSize: { width: number; height: number };
  viewportMargin: number;
  selectionGap: number;
}

export function getSelectionToolbarPosition({
  selectionBounds,
  viewport,
  toolbarSize,
  viewportMargin,
  selectionGap,
}: SelectionToolbarPositionParams): { left: number; top: number } {
  const minLeft = viewport.left + viewportMargin;
  const maxLeft = Math.max(
    minLeft,
    viewport.left + viewport.width - viewportMargin - toolbarSize.width,
  );
  const left = clamp(
    selectionBounds.left + selectionBounds.width / 2 - toolbarSize.width / 2,
    minLeft,
    maxLeft,
  );
  const minTop = viewport.top + viewportMargin;
  const maxTop = Math.max(
    minTop,
    viewport.top + viewport.height - viewportMargin - toolbarSize.height,
  );
  const aboveTop = selectionBounds.top - toolbarSize.height - selectionGap;
  const belowTop = selectionBounds.top + selectionBounds.height + selectionGap;

  return {
    left,
    top: clamp(aboveTop >= minTop ? aboveTop : belowTop, minTop, maxTop),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
