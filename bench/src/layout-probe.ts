let totalMs = 0;
let frames = 0;
let running = false;

/**
 * Split style recalculation and layout out of the browser's share of a frame.
 *
 * `browser` is everything left after the JavaScript, which lumps style, layout,
 * paint, raster and compositing into one number. On the desktop a Chrome trace
 * takes that apart; WebKit hands JavaScript nothing equivalent, so on the device
 * the largest number in the table has been the least specific one.
 *
 * Style and layout can still be timed from inside the page, because they can be
 * forced: reading a geometry property makes the engine flush whatever the frame
 * dirtied, then and there. Timing that read attributes the flush. What is left
 * of `browser` afterwards is paint, raster and compositing — which is not a
 * breakdown, but it does answer "is this frame expensive because of what it
 * recomputes or because of what it draws", which is the fork every remaining
 * candidate sits on.
 *
 * This moves work rather than adding it: the engine would have run the same
 * flush moments later during rendering. It only holds while this callback is
 * the last one to run — anything writing styles afterwards would dirty the tree
 * again and be flushed a second time, so the probe registers itself from a
 * timer, which fires once every animation callback for the frame has already
 * queued its successor.
 */
export function startLayoutProbe(): void {
  if (running) {
    return;
  }
  running = true;
  // A timer, not a direct call: registering from inside an animation frame
  // would queue this ahead of loops that re-register at the end of their own
  // callback, and it has to run after all of them.
  window.setTimeout(() => {
    const tick = () => {
      const start = performance.now();
      // Read, do not write. `offsetHeight` on the root forces style recalc and
      // layout for everything dirtied this frame, and nothing else.
      void document.documentElement.offsetHeight;
      totalMs += performance.now() - start;
      frames++;
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }, 0);
}

/**
 * Forced style-and-layout time and the frames it covers, since the page loaded.
 *
 * Totals rather than a mean, so a caller can subtract a snapshot taken when
 * measurement began and leave the warmup out of it.
 */
export function layoutProbeTotals(): { ms: number; frames: number } {
  return { ms: totalMs, frames };
}
