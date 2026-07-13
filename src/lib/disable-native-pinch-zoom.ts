/**
 * WKWebView (iOS) applies its own page pinch-zoom on top of our canvas gesture
 * handling, so a two-finger pinch anywhere — home, sidebar, or a non-edit
 * canvas — scales the entire UI. The viewport meta's `user-scalable=no` blocks
 * most of it, but WebKit also emits a separate `gesture*` event stream for
 * pinches that bypasses the viewport scale limit; preventing those stops the
 * residual whole-page zoom.
 *
 * These events are WebKit-only and distinct from the `touchstart`/`touchmove`
 * stream the canvas viewport listens to, so this never interferes with the
 * canvas's own two-finger pinch in edit mode.
 */
export function disableNativePinchZoom(): void {
  const prevent = (evt: Event): void => {
    evt.preventDefault();
  };
  document.addEventListener('gesturestart', prevent);
  document.addEventListener('gesturechange', prevent);
  document.addEventListener('gestureend', prevent);
}
