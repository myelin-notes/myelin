import type { CanvasViewport } from '@myelin/editor/canvas-viewport';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from '@myelin/editor/elements/page-frame-constants';

/**
 * How the plain div follows the view.
 *
 * `scale` keeps the box a fixed size and puts the zoom on the transform, which
 * is the cheap way. `resize` rewrites width and height in screen pixels every
 * frame, which is what the page-frame chrome does. `promoted` adds the
 * `will-change: transform` the chrome also carries — a compositing layer whose
 * size changes every frame has to reallocate its backing store every frame,
 * which is a very different thing from one that merely moves.
 */
export type PlainFrameMode = 'scale' | 'resize' | 'promoted';

/**
 * A white rectangle the size of a page, positioned like one, containing
 * nothing.
 *
 * The control this investigation never had. A page frame costs 14ms of a zoom
 * frame while being, visibly, a blank sheet — so either that is what an element
 * of that size costs on this hardware, or it is something the chrome does to
 * it. Nothing in a suite of ablations can tell those apart, because every row
 * still contains the chrome. This row does not: no shadow, no border, no
 * corner radius, no editor, no header, no clipping, no nested transforms.
 *
 * If this is free, the 14ms is ours and worth decomposing. If this is also
 * expensive, the chrome is not the problem and the page frame cannot be made
 * cheap by trimming what it draws.
 */
export function createPlainFrame(
  host: HTMLElement,
  mode: PlainFrameMode,
): (viewport: CanvasViewport) => void {
  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.left = '0px';
  div.style.top = '0px';
  div.style.transformOrigin = '0 0';
  div.style.background = 'var(--bg-card)';
  div.style.pointerEvents = 'none';
  if (mode === 'scale') {
    div.style.width = `${PAGE_WIDTH}px`;
    div.style.height = `${PAGE_HEIGHT}px`;
  }
  if (mode === 'promoted') {
    div.style.willChange = 'transform';
  }
  host.appendChild(div);

  // The page frame scene centres its first page on the origin, so the plain
  // div sits where a real one would and covers the same pixels.
  const worldX = -PAGE_WIDTH / 2;
  const worldY = -PAGE_HEIGHT / 2;

  return (viewport: CanvasViewport) => {
    const zoom = viewport.zoom;
    const offset = viewport.offset;
    const screenX = (worldX + offset.x) * zoom;
    const screenY = (worldY + offset.y) * zoom;

    if (mode === 'scale') {
      div.style.transform = `translate(${screenX}px, ${screenY}px) scale(${zoom})`;
      return;
    }
    div.style.transform = `translate(${screenX}px, ${screenY}px)`;
    div.style.width = `${PAGE_WIDTH * zoom}px`;
    div.style.height = `${PAGE_HEIGHT * zoom}px`;
  };
}
