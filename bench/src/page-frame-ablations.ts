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
const promoted = new WeakSet<HTMLElement>();
const deshadowed = new WeakSet<HTMLElement>();

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
