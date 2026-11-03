import { type RefObject, useLayoutEffect } from 'react';
import {
  getVisibleElementBounds,
  getVisibleViewportBounds,
} from '@myelin/shared/visible-viewport';

const EDGE_MARGIN = 8;

/**
 * For a popover hung `top-full left-1/2` with `translateX(-50%)` off its trigger: flips it above the
 * trigger when it would run off the bottom, and shifts it sideways onto the screen or canvas.
 */
export function useKeepPopoverOnScreen(
  popoverRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    const trigger = popover?.offsetParent;
    if (!(popover && trigger)) {
      return;
    }
    const canvas = popover.closest('[data-canvas-root]');
    const visible = canvas
      ? getVisibleElementBounds(canvas)
      : getVisibleViewportBounds();
    const anchor = trigger.getBoundingClientRect();
    // offset sizes, as these zoom in on open and a transformed rect would mislead.
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const gap = Number.parseFloat(getComputedStyle(popover).marginTop) || 0;

    const fitsBelow = anchor.bottom + gap + height <= visible.bottom;
    const fitsAbove = anchor.top - gap - height >= visible.top;
    if (!fitsBelow && fitsAbove) {
      popover.style.top = 'auto';
      popover.style.bottom = '100%';
      popover.style.marginTop = '0';
      popover.style.marginBottom = `${gap}px`;
    }

    const center = anchor.left + anchor.width / 2;
    const overflowLeft = visible.left + EDGE_MARGIN - (center - width / 2);
    const overflowRight = center + width / 2 - (visible.right - EDGE_MARGIN);
    const shift =
      overflowLeft > 0 ? overflowLeft : overflowRight > 0 ? -overflowRight : 0;
    if (shift !== 0) {
      popover.style.transform = `translateX(calc(-50% + ${shift}px))`;
    }
  }, [popoverRef]);
}
