import { type RefObject, useLayoutEffect } from 'react';
import {
  getVisibleElementBounds,
  subscribeVisibleViewport,
} from '@myelin/shared/visible-viewport';

/**
 * Publishes the on-screen part of the canvas as `--canvas-visible-width` and
 * `--canvas-visible-height`. The canvas clips its children, so panels inside it must size against
 * these: `100dvh` and `100vw` also count the tab bar, the system bars and any split pane.
 */
export function useVisibleCanvasSize(rootRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const sync = () => {
      const { left, top, right, bottom } = getVisibleElementBounds(root);
      root.style.setProperty(
        '--canvas-visible-width',
        `${Math.max(0, right - left)}px`,
      );
      root.style.setProperty(
        '--canvas-visible-height',
        `${Math.max(0, bottom - top)}px`,
      );
    };
    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(root);
    const unsubscribe = subscribeVisibleViewport(sync);
    return () => {
      resizeObserver.disconnect();
      unsubscribe();
    };
  }, [rootRef]);
}
