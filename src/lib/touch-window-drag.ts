import { isWindows } from '@myelin/shared/os';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Tauri's injected drag-region script only listens for `mousedown`, which touch never fires until
 * the finger lifts, so a touch drag on the custom Windows title bar panned the content instead.
 */
export function enableTouchWindowDrag(): void {
  if (!isWindows) {
    return;
  }
  document.addEventListener(
    'touchstart',
    (evt: TouchEvent): void => {
      // Direct hits only, matching Tauri's bare-attribute semantics, so tabs and buttons on the bar keep their touch behavior.
      if (
        evt.touches.length === 1 &&
        evt.target instanceof HTMLElement &&
        evt.target.hasAttribute('data-tauri-drag-region')
      ) {
        evt.preventDefault();
        void getCurrentWindow().startDragging();
      }
    },
    { passive: false },
  );
}
