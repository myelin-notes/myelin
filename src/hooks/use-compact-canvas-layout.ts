import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * Viewport too narrow for the canvas chrome's desktop geometry: the left tool
 * rail plus a side-anchored panel needs ~300px of horizontal room, which is
 * most of a phone in portrait. Matches the sidebar's compact breakpoint so the
 * whole window reflows at one width.
 */
const CANVAS_COMPACT_QUERY = '(max-width: 767px)';

/**
 * Whether the canvas chrome should use its compact layout: tools in a bottom
 * bar rather than a left rail. Viewport-driven, so a phone in landscape (wide,
 * short) keeps the rail, where vertical space is the scarce axis instead.
 */
export function useCompactCanvasLayout(): boolean {
  return useMediaQuery(CANVAS_COMPACT_QUERY);
}
