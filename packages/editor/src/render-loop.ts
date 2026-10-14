import type { DrawableCanvas } from './drawable-canvas';

/**
 * Drives a {@link DrawableCanvas} on demand: a frame is scheduled only when the canvas requests a
 * redraw or the previous frame reported an animation still in progress, so an idle canvas schedules
 * nothing. Returns a stop function that cancels the loop and guarantees no further frames are
 * scheduled, even if `stop` is called from inside a `redraw` for the in-flight frame.
 */
export function startDrawableCanvasAnimationLoop(
  drawableCanvas: Pick<DrawableCanvas, 'redraw' | 'setRedrawScheduler'>,
  onFps: (fps: number) => void,
): () => void {
  // `null` after a frame that let the loop go idle, so the next frame's delta is 0 rather than the
  // whole idle gap — a selection made after a pause would otherwise skip its fade-in.
  let previousTime: number | null = null;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let frameId = 0;
  let stopped = false;

  function schedule() {
    if (!stopped && frameId === 0) {
      frameId = requestAnimationFrame(animate);
    }
  }

  function animate(time: number) {
    frameId = 0;
    if (stopped) {
      return;
    }

    const dt = previousTime === null ? 0 : (time - previousTime) / 1000;
    const animating = drawableCanvas.redraw(dt);
    if (stopped) {
      return;
    }

    if (dt > 0) {
      fpsAccum += dt;
      fpsFrames += 1;
      if (fpsAccum >= 0.5) {
        const fps = Math.round(fpsFrames / fpsAccum);
        fpsAccum = 0;
        fpsFrames = 0;
        onFps(fps);
        if (stopped) {
          return;
        }
      }
    }

    if (animating) {
      schedule();
    }
    previousTime = frameId === 0 ? null : time;
  }

  drawableCanvas.setRedrawScheduler(schedule);
  schedule();
  return () => {
    stopped = true;
    cancelAnimationFrame(frameId);
    frameId = 0;
    drawableCanvas.setRedrawScheduler(null);
  };
}
