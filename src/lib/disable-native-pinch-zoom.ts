/**
 * `user-scalable=no` doesn't cover WebKit's `gesture*` stream, which zooms the whole webview UI.
 * CanvasViewport listens for the same events on the canvas and runs first, so its pinch survives.
 */
export function disableNativePinchZoom(): void {
  const prevent = (evt: Event): void => {
    evt.preventDefault();
  };
  document.addEventListener('gesturestart', prevent);
  document.addEventListener('gesturechange', prevent);
  document.addEventListener('gestureend', prevent);
}
