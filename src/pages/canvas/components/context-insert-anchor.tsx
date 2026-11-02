import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { getVisibleElementBounds } from '@myelin/shared/visible-viewport';

const EDGE_MARGIN = 8;

function keepOnCanvas(
  desired: number,
  size: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min + EDGE_MARGIN,
    Math.min(desired, max - EDGE_MARGIN - size),
  );
}

/** Holds the right-click insert menu at a canvas-relative point, nudged to stay on the canvas. */
export function ContextInsertAnchor({
  screenX,
  screenY,
  children,
}: {
  screenX: number;
  screenY: number;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const canvas = anchor?.offsetParent;
    if (!(anchor && canvas)) {
      return;
    }
    const origin = canvas.getBoundingClientRect();
    const bounds = getVisibleElementBounds(canvas);
    const left = keepOnCanvas(
      origin.left + screenX,
      anchor.offsetWidth,
      bounds.left,
      bounds.right,
    );
    const top = keepOnCanvas(
      origin.top + screenY,
      anchor.offsetHeight,
      bounds.top,
      bounds.bottom,
    );
    anchor.style.left = `${left - origin.left}px`;
    anchor.style.top = `${top - origin.top}px`;
  }, [screenX, screenY]);

  return (
    <div
      ref={anchorRef}
      className="pointer-events-auto absolute z-20"
      style={{ left: screenX, top: screenY }}
    >
      {children}
    </div>
  );
}
