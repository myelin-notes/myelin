import { IS_MOBILE_BUILD } from '@/lib/env';

const TABLET_SCALE = 1.25;
/** Shorter screen edge, in CSS px, at or above which we scale. */
const TABLET_MIN_EDGE = 700;

/**
 * Phones are too narrow for the tab strip (and have no hover for its close buttons), so they run a
 * single-document layout — see {@link SidebarContextValue.phoneLayout}.
 *
 * Reads `window.screen` rather than a media query so it agrees with the tablet scaling above: once
 * that zoom applies, viewport width no longer reflects the device.
 */
export const IS_PHONE_BUILD =
  IS_MOBILE_BUILD &&
  Math.min(window.screen.width, window.screen.height) < TABLET_MIN_EDGE;

/**
 * Zoom the whole webview on tablet mobile builds so mouse-sized controls land on a comfortable
 * touch target. Must run before first paint.
 *
 * Drops `width=device-width` deliberately: the used viewport width is `max(width, deviceWidth /
 * scale)`, so keeping it would pin the layout at full device width and scroll sideways.
 */
export function applyMobileViewportScale(): void {
  if (!IS_MOBILE_BUILD) {
    return;
  }
  const shortEdge = Math.min(window.screen.width, window.screen.height);
  if (shortEdge < TABLET_MIN_EDGE) {
    return;
  }
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    return;
  }
  meta.setAttribute(
    'content',
    `initial-scale=${TABLET_SCALE}, minimum-scale=${TABLET_SCALE}, maximum-scale=${TABLET_SCALE}, user-scalable=no, viewport-fit=cover`,
  );
}
