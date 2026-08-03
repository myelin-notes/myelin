/**
 * Give each page frame's scaled inner viewport its own compositor layer.
 *
 * The DOM layer sizes that element in world units, has WebKit rasterize it at
 * `zoom: devicePixelRatio`, and applies the canvas zoom as `transform: scale()`
 * — a design whose stated point is that the zoom is "a post-layout GPU
 * operation". That is only true if the scaled element is composited. It is not,
 * so today a zoom repaints the whole chrome subtree instead.
 *
 * Promoting it is a one-line change to `VIEWPORT_STYLE`, and a Chrome trace put
 * it at 33 tile rasterizations per frame down to 13. It is applied from here
 * rather than shipped because a promoted layer holds its raster scale, and page
 * text could then stay soft after a zoom settles instead of re-sharpening —
 * which is a WebKit question, so the device has to answer it.
 *
 * The inner viewport is identified by carrying an inline `zoom`, which nothing
 * else on the page sets. That is sturdier than walking a fixed depth of
 * wrappers, which the chrome is free to change.
 */
const promoted = new WeakSet<HTMLElement>();

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
