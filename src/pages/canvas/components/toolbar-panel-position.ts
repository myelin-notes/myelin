import type { VisibleBounds } from '@myelin/shared/visible-viewport';

interface ToolbarPanelTopParams {
  desiredTop: number;
  panelHeight: number;
  bounds: VisibleBounds;
  margin: number;
}

/** Viewport y for a panel's top: as close to `desiredTop` as stays inside `bounds`. */
export function getToolbarPanelTop({
  desiredTop,
  panelHeight,
  bounds,
  margin,
}: ToolbarPanelTopParams): number {
  const minTop = bounds.top + margin;
  const maxTop = bounds.bottom - margin - panelHeight;
  return Math.max(minTop, Math.min(desiredTop, maxTop));
}
