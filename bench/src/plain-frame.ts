import type { CanvasViewport } from '@myelin/editor/canvas-viewport';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from '@myelin/editor/elements/page-frame-constants';
import { quantizeRasterZoom } from '@myelin/editor/raster-zoom';
import { setStyleIfChanged } from '@myelin/editor/utils/style-cache';

/**
 * How the plain div follows the view.
 *
 * `scale` keeps the box a fixed size and puts the zoom on the transform, which
 * is the cheap way. `resize` rewrites width and height in screen pixels every
 * frame, which is what the page-frame chrome did before it was laid out at zoom
 * steps. `promoted` adds the `will-change: transform` the chrome also carries —
 * a compositing layer whose size changes every frame has to reallocate its
 * backing store every frame, which is a very different thing from one that
 * merely moves.
 *
 * `stepped` and `held` are the pair that prices what the chrome does *now*.
 * @see SHEET_SHADOW
 */
export type PlainFrameMode =
  | 'scale'
  | 'resize'
  | 'promoted'
  | 'stepped'
  | 'held';

/**
 * The page sheet's own shadow, on the two modes that carry one.
 *
 * `stepped` and `held` differ by one thing — whether the layer's transform
 * scale changes between zoom steps — and the question is whether that alone
 * repaints it. A repaint of a bare rectangle is too cheap to resolve against
 * the spread, so the answer would come back "no difference" whether or not the
 * layer repainted. A 72px blur over a page-sized box is the most expensive
 * thing in the real chrome's repaint, so putting it on both sides makes a
 * repaint show up as a gap large enough to read. WebKit reports no raster
 * counts to JavaScript; subtracting two runs is the only instrument the device
 * has.
 *
 * Copied from the sheet in `elements/frame/chrome-view.tsx`, and applied in
 * unscaled pixels to a box sized at the quantized zoom — the same geometry the
 * real one has.
 */
const SHEET_SHADOW =
  '0 0 0 1px rgb(var(--shadow-rgb-elevated) / 0.10), 0 1px 2px rgb(var(--shadow-rgb) / 0.06), 0 10px 20px -8px rgb(var(--shadow-rgb) / 0.10), 0 36px 72px -24px rgb(var(--shadow-rgb) / 0.22)';

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
 *
 * The `stepped`/`held` pair asks a narrower question of the same rectangle.
 * Laying the chrome out at zoom steps was supposed to leave a zoom with nothing
 * to repaint, and an iPad timeline says it did not: with the quantization
 * shipped, the page-frame subtree still repainted on 56 of 60 zoom frames, and
 * those frames cost 42.0ms of compositing against 8.4ms for the four that did
 * not. Nothing in that subtree is restyled or relaid out on those frames, so
 * the only thing left changing is the residual `scale()` the root carries
 * between steps. These two modes are that difference and nothing else: same
 * box, same size writes, same promotion, same shadow — one rescaled every
 * frame, one never. If the gap is there on a rectangle, it is a fact about
 * scaling a promoted layer, and the approach cannot be rescued by trimming
 * what the chrome draws.
 */
export function createPlainFrame(
  host: HTMLElement,
  mode: PlainFrameMode,
  count = 1,
): (viewport: CanvasViewport) => void {
  const stepped = mode === 'stepped' || mode === 'held';
  const divs: HTMLDivElement[] = [];
  for (let i = 0; i < Math.max(1, count); i++) {
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
    if (mode === 'promoted' || stepped) {
      div.style.willChange = 'transform';
    }
    if (stepped) {
      div.style.boxShadow = SHEET_SHADOW;
    }
    host.appendChild(div);
    divs.push(div);
  }

  // The page frame scene centres its first page on the origin, so the plain
  // div sits where a real one would and covers the same pixels. `count` rects
  // stack on that one spot rather than tiling outward: the question is what
  // rescaling a promoted layer costs, so the screen coverage has to stay fixed
  // and only the number of layers doing it may change. Overdraw is the point —
  // it multiplies the cost under test without touching the geometry.
  const worldX = -PAGE_WIDTH / 2;
  const worldY = -PAGE_HEIGHT / 2;

  return (viewport: CanvasViewport) => {
    const zoom = viewport.zoom;
    const offset = viewport.offset;
    const screenX = (worldX + offset.x) * zoom;
    const screenY = (worldY + offset.y) * zoom;

    const rasterZoom = stepped ? quantizeRasterZoom(zoom) : 1;

    for (const div of divs) {
      if (mode === 'scale') {
        div.style.transform = `translate(${screenX}px, ${screenY}px) scale(${zoom})`;
        continue;
      }

      if (stepped) {
        // Guarded exactly as the chrome guards its own, because an identical
        // string still dirties the element. Unguarded, `held` would repaint
        // every frame from the size writes and report no gap no matter what
        // the scale is doing — which is the result this pair exists to rule
        // out.
        setStyleIfChanged(div, 'width', `${PAGE_WIDTH * rasterZoom}px`);
        setStyleIfChanged(div, 'height', `${PAGE_HEIGHT * rasterZoom}px`);
        setStyleIfChanged(
          div,
          'transform',
          mode === 'stepped'
            ? `translate(${screenX}px, ${screenY}px) scale(${zoom / rasterZoom})`
            : // Never rescaled, so between two steps this layer is asked for
              // nothing but a translate. It renders up to 41% small, which is
              // wrong on screen and is the whole point: it is the floor a layer
              // that only moves can reach.
              `translate(${screenX}px, ${screenY}px)`,
        );
        continue;
      }

      div.style.transform = `translate(${screenX}px, ${screenY}px)`;
      div.style.width = `${PAGE_WIDTH * zoom}px`;
      div.style.height = `${PAGE_HEIGHT * zoom}px`;
    }
  };
}
