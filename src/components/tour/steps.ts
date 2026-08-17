export type TourStepId =
  | 'explorer'
  | 'search'
  | 'tools'
  | 'insert'
  | 'settings';

export type TourPlacement = 'right' | 'bottom';

export interface TourStep {
  id: TourStepId;
  /** Value of the `data-tour` attribute on the element to highlight. */
  anchor: string;
  placement: TourPlacement;
}

/**
 * The stops of the first-run tour, in the order they are visited. Anchors that
 * aren't on screen are dropped when the tour starts, which is what keeps the
 * mobile build — where there is no sidebar — from pointing at nothing.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'explorer', anchor: 'sidebar-explorer', placement: 'right' },
  { id: 'search', anchor: 'sidebar-search', placement: 'right' },
  { id: 'tools', anchor: 'canvas-toolbar', placement: 'right' },
  { id: 'insert', anchor: 'canvas-insert', placement: 'right' },
  { id: 'settings', anchor: 'sidebar-settings', placement: 'bottom' },
];

/** The stop that only exists once a canvas is open, so the tour waits for it. */
export const CANVAS_TOUR_ANCHOR = 'canvas-toolbar';

export function anchorSelector(anchor: string): string {
  return `[data-tour="${anchor}"]`;
}

export function resolveTourSteps(
  hasAnchor: (anchor: string) => boolean,
): TourStep[] {
  return TOUR_STEPS.filter((step) => hasAnchor(step.anchor));
}
