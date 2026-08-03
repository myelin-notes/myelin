import {
  BG_TILE_SIZE,
  backgroundPanShift,
} from '@myelin/editor/canvas-renderer';
import type { CanvasViewport } from '@myelin/editor/canvas-viewport';

/**
 * Restore the background layer's pre-fix behaviour, from outside the renderer.
 *
 * The renderer now paints the tiling at half-octave zoom steps and carries the
 * remainder on the layer's transform, so a zoom repaints only when it crosses a
 * step. That change was justified by a Chrome trace — a backend that has been
 * confidently wrong about this layer once already, when it priced a
 * `CanvasPattern` fill at 11ms that the iPad did not notice.
 *
 * WebKit exposes no raster counts to JavaScript, so the only way to check the
 * fix on the device is to run both behaviours and subtract. This writes what the
 * old code wrote — the tile sized to the exact zoom, and a transform with no
 * scale — after the renderer has written its own, so the frame ends in the old
 * state and looks identical to the old build. It is deliberately *not* a
 * reimplementation of the layer: it only overwrites the two properties the fix
 * changed.
 */
export function applyExactZoomBackground(
  host: HTMLElement,
  viewport: CanvasViewport,
): void {
  const zoom = viewport.zoom;
  const offset = viewport.offset;
  const tile = BG_TILE_SIZE * zoom;
  host.style.backgroundSize = `${tile}px ${tile}px`;
  host.style.transform = `translate3d(${backgroundPanShift(offset.x * zoom, tile)}px, ${backgroundPanShift(offset.y * zoom, tile)}px, 0)`;
}
