let maxDevicePixelRatio = Number.POSITIVE_INFINITY;

/**
 * Cap the backing-store scale of every canvas layer. Tablet builds set this at
 * bootstrap so an old iPad rasterizes far fewer pixels per layer per frame;
 * desktop and the website leave it uncapped.
 *
 * Set it once, before any canvas mounts. Every canvas is sized by
 * `renderScale()` and every conversion back to logical pixels divides by it, so
 * changing it mid-session would leave canvases sized under the old value until
 * their next resize.
 */
export function setMaxDevicePixelRatio(max: number): void {
  maxDevicePixelRatio = max;
}

/** Backing-store pixels per logical pixel, honouring the tablet cap. */
export function renderScale(): number {
  return Math.min(window.devicePixelRatio || 1, maxDevicePixelRatio);
}

/**
 * A canvas's size in logical (CSS) pixels.
 *
 * Backing stores are sized at `renderScale()`, which is NOT `devicePixelRatio`
 * when the tablet cap is active — dividing by the raw ratio yields a viewport
 * a third too small on an iPad, which throws off anything derived from it
 * (fit-to-frame zoom, pan clamping, viewport-center placement).
 */
export function canvasLogicalSize(canvas: HTMLCanvasElement): {
  width: number;
  height: number;
} {
  const scale = renderScale();
  return { width: canvas.width / scale, height: canvas.height / scale };
}
