import type { TourPlacement } from './steps';

export interface TourRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TourSize {
  width: number;
  height: number;
}

const GAP = 16;
const MARGIN = 16;

/**
 * Place the tour card beside its anchor, flipping to the opposite side when
 * the preferred one would run off screen and clamping so the card is always
 * fully visible even when the anchor hugs a window edge.
 */
export function positionTourCard(
  anchor: TourRect,
  placement: TourPlacement,
  card: TourSize,
  viewport: TourSize,
): { left: number; top: number } {
  let left =
    placement === 'right' ? anchor.left + anchor.width + GAP : anchor.left;
  let top =
    placement === 'right' ? anchor.top : anchor.top + anchor.height + GAP;

  if (placement === 'right' && left + card.width + MARGIN > viewport.width) {
    left = anchor.left - GAP - card.width;
  }
  if (placement === 'bottom' && top + card.height + MARGIN > viewport.height) {
    top = anchor.top - GAP - card.height;
  }

  return {
    left: clamp(left, MARGIN, viewport.width - card.width - MARGIN),
    top: clamp(top, MARGIN, viewport.height - card.height - MARGIN),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}
