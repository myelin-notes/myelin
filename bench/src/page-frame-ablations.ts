/**
 * Give each page frame's scaled inner viewport its own compositor layer.
 *
 * KEPT AS A RECORD OF A NEGATIVE RESULT. Do not ship this.
 *
 * The DOM layer sizes that element in world units, has WebKit rasterize it at
 * `zoom: devicePixelRatio`, and applies the canvas zoom as `transform: scale()`
 * — a design whose stated point is that the zoom is "a post-layout GPU
 * operation". That is only true if the scaled element is composited, and it is
 * not, so a zoom repaints the whole chrome subtree. Promoting it is one line in
 * `VIEWPORT_STYLE`, and a Chrome trace put it at 33 tile rasterizations per
 * frame down to 13, worth 7.74ms to 6.99ms.
 *
 * On the iPad it is worse, by a lot, and not marginally:
 *
 *   1 page frame, zoom     33.80ms -> 48.07ms   (30fps -> 21fps)
 *   3 page frames, zoom    41.98ms -> 66.47ms   (24fps -> 15fps)
 *
 * with spreads under 1.2ms. `zoom: dpr` makes that element's layout box four
 * times the page's area at dpr 2, so promoting it hands WebKit a backing store
 * that large to allocate, rasterize and composite on its own — which costs more
 * than painting it into the parent, and which Chromium's tile cache hides.
 *
 * The general lesson is worth more than the row: a promotion that a desktop
 * trace shows removing raster can still lose on the device, because the trace
 * counts the work avoided and not the layer created.
 *
 * The inner viewport is identified by carrying an inline `zoom`, which nothing
 * else on the page sets. That is sturdier than walking a fixed depth of
 * wrappers, which the chrome is free to change.
 */
import { FrameChrome } from '@myelin/editor/elements/frame/chrome';
import { PM_EDITOR_CLASS } from '@myelin/editor/page-frame/pm/constants';

const hiddenEditors = new WeakSet<HTMLElement>();

/**
 * Hide the ProseMirror editor inside each page frame.
 *
 * A page-sized white rectangle costs nothing on the device — 0.4ms even when
 * resized and promoted every frame — while a page frame costs 14.63ms. So the
 * cost is not the element, its size, or how it follows the view. It is what is
 * inside it, and the largest thing inside it is a live contenteditable with the
 * editor's whole stylesheet applied.
 *
 * The bench's documents are empty, so this should be free and almost certainly
 * is not. Nothing in the sync loop writes `display`, so one write holds.
 */
export function hidePageFrameEditors(): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    `[data-frame-chrome] .${PM_EDITOR_CLASS}`,
  )) {
    if (hiddenEditors.has(element)) {
      continue;
    }
    element.style.display = 'none';
    hiddenEditors.add(element);
  }
}

const promoted = new WeakSet<HTMLElement>();
const deshadowed = new WeakSet<HTMLElement>();
const demoted = new WeakSet<HTMLElement>();

/**
 * Take `will-change: transform` off the frame chrome's root.
 *
 * The root is promoted so that a pan moves a texture instead of repainting the
 * subtree, which it measurably does. But a zoom also rewrites that element's
 * width, height and border radius every frame — and resizing a compositing
 * layer is not the same as moving one. The backing store has to be
 * reallocated at the new size and repainted whole, every frame, with no
 * partial invalidation possible.
 *
 * So the hint that makes panning cheap may be what makes zooming expensive,
 * and if so the fix is not to trim what the chrome draws but to stop changing
 * the layer's size — put the zoom on its transform, the way the background
 * layer now works.
 */
export function demotePageFrameChrome(): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-frame-chrome]',
  )) {
    if (demoted.has(element)) {
      continue;
    }
    element.style.willChange = 'auto';
    demoted.add(element);
  }
}

let rasterScalePinned = false;

/**
 * Stop the chrome root carrying the residual zoom on its transform.
 *
 * The subtree is laid out at half-octave zoom steps and the root scales by
 * `zoom / rasterZoom` to make up the difference, on the premise that the
 * compositor then rescales a texture it already has. An iPad timeline says it
 * does not: the subtree still repainted on 56 of 60 zoom frames, at 42.0ms of
 * compositing against 8.4ms for the four that did not, with no style recalc or
 * layout in the subtree to account for it — and the tiles came back 512px wide
 * on some frames and 524px on others, which is one grid rasterized at scales
 * 2.4% apart rather than a grid that changed size.
 *
 * A rectangle already answered the narrow version of this and answered it no:
 * eight promoted, shadowed, page-sized layers rescaled every frame measured
 * 19.04ms against 18.82ms for eight that were never rescaled, inside a 2.11ms
 * spread. But that rect is a leaf, and the chrome root is not — it wraps an
 * inner viewport carrying `zoom: devicePixelRatio` and a nested `scale()`, and
 * keeping *that* crisp across a changing ancestor scale is a different job from
 * keeping a flat fill crisp. This ablation asks the question of the real thing.
 *
 * Patched onto the prototype rather than written over the element afterwards.
 * The transform is authored by the DOM layer's own animation loop, which
 * registers after the bench's and therefore writes last; anything written from
 * outside would be overwritten before the frame was composited. Running inside
 * the call makes write order irrelevant.
 *
 * The original still writes the scaled transform first, so the layer takes two
 * transform writes per frame instead of one. Both are transform-only writes on
 * a promoted layer, which the rectangle above priced at nothing.
 *
 * With this on, the frame renders up to 41% small between steps and snaps at
 * each one. That is wrong on screen and expected: it is what a subtree that is
 * never rescaled looks like.
 */
export function pinChromeRasterScale(): void {
  if (rasterScalePinned) {
    return;
  }
  rasterScalePinned = true;

  const original = FrameChrome.prototype.sync;
  FrameChrome.prototype.sync = function pinned(
    this: FrameChrome,
    params: Parameters<typeof original>[0],
  ): void {
    original.call(this, params);
    const transform = this.root.style.transform;
    const translateOnly = transform.replace(/\s*scale\([^)]*\)\s*$/, '');
    if (translateOnly === transform) {
      // Nothing was stripped, so this row is measuring the shipped behaviour
      // under a label that says otherwise — a "no difference" result that means
      // the ablation broke, not that the scale is free. The chrome would have
      // to have changed how it writes the transform for this to happen; fail
      // the run rather than report a number that reads like an answer.
      throw new Error(
        `bench: chrome transform carried no scale to pin ("${transform}")`,
      );
    }
    this.root.style.transform = translateOnly;
  };
}

export function promotePageFrameViewports(): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-frame-chrome] div',
  )) {
    if (element.style.zoom === '' || promoted.has(element)) {
      continue;
    }
    element.style.willChange = 'transform';
    promoted.add(element);
  }
}

/**
 * A narrower blur, keeping the same colour and offset.
 *
 * The device puts the shipped `0 4px 24px` at 7.74ms of a zoom frame, over half
 * of what a page frame costs. This is what decides how to spend that: if the
 * cost follows the blur radius, narrowing it is a one-line change, and if a
 * narrow blur costs the same as a wide one then the shadow has to stop being
 * recomputed at all — pre-rendered once and scaled, the way the canvas
 * background now is.
 */
const SMALL_SHADOW = '0 2px 6px rgb(var(--shadow-rgb) / 0.08)';

/**
 * Rewrite the drop-shadow on each page sheet.
 *
 * The sheet carries `0 4px 24px` of blur, and a blur that wide over a
 * page-sized rect is one of the more expensive things a repaint can contain.
 * It was priced once before and measured free — but that was on a pan, where
 * the chrome does not repaint at all, so the measurement could only ever have
 * come back free. A zoom repaints it every frame.
 *
 * Safe to write once and leave: the sync loop only ever rewrites the sheet's
 * position and size, never its shadow.
 */
export function setPageFrameShadows(shadow: 'small' | 'off'): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-frame-chrome] div',
  )) {
    if (element.style.boxShadow === '' || deshadowed.has(element)) {
      continue;
    }
    element.style.boxShadow = shadow === 'off' ? 'none' : SMALL_SHADOW;
    deshadowed.add(element);
  }
}
