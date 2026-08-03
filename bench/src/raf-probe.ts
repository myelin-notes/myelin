let totalMs = 0;
let installed = false;

/**
 * Time every `requestAnimationFrame` callback on the page, not just ours.
 *
 * `js` only wraps `DrawableCanvas.redraw`, so any work driven by a *different*
 * animation loop has been invisible in every measurement so far — and the
 * page-frame DOM layer runs exactly such a loop, syncing frame geometry on its
 * own schedule. A page frame costs several milliseconds per frame that none of
 * the candidates we could see accounted for, which is the shape of a cost
 * sitting in a blind spot.
 *
 * Wrapping at the `requestAnimationFrame` level catches every loop regardless
 * of who registered it. The original handle is returned unchanged so
 * `cancelAnimationFrame` still works.
 *
 * Install before anything registers a callback: a loop that started first keeps
 * calling the original function and stays uncounted.
 */
export function installRafProbe(): void {
  if (installed) {
    return;
  }
  installed = true;
  const original = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    original((time) => {
      const start = performance.now();
      try {
        callback(time);
      } finally {
        totalMs += performance.now() - start;
      }
    });
}

/** Total time spent inside animation-frame callbacks since the page loaded. */
export function rafTotalMs(): number {
  return totalMs;
}
