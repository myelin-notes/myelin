import { isWindows } from '@myelin/shared/os';

/**
 * Keeps browser-level zoom out of the app while CanvasViewport handles its own pinch gestures.
 */
export function disableNativePinchZoom(): void {
  const prevent = (evt: Event): void => {
    evt.preventDefault();
  };
  document.addEventListener('gesturestart', prevent);
  document.addEventListener('gesturechange', prevent);
  document.addEventListener('gestureend', prevent);

  if (!isWindows) {
    return;
  }

  document.addEventListener(
    'wheel',
    (evt: WheelEvent): void => {
      if (evt.ctrlKey) {
        evt.preventDefault();
      }
    },
    { capture: true, passive: false },
  );
  document.addEventListener(
    'keydown',
    (evt: KeyboardEvent): void => {
      if (evt.ctrlKey && ['+', '=', '-', '0'].includes(evt.key)) {
        evt.preventDefault();
      }
    },
    { capture: true },
  );
}
