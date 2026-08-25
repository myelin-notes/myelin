/**
 * WKWebView applies its own page pinch-zoom on top of our canvas gesture handling, so a two-finger
 * pinch anywhere scales the entire UI. `user-scalable=no` blocks most of it, but WebKit also emits
 * a separate `gesture*` event stream that bypasses the viewport scale limit.
 *
 * Those events are WebKit-only and distinct from the `touchstart`/`touchmove` stream the canvas
 * viewport listens to, so this never interferes with the canvas's own pinch in edit mode.
 */
export function disableNativePinchZoom(): void {
  const prevent = (evt: Event): void => {
    evt.preventDefault();
  };
  document.addEventListener('gesturestart', prevent);
  document.addEventListener('gesturechange', prevent);
  document.addEventListener('gestureend', prevent);
}
