import { flushCanvasInputSample, recordCanvasPerf } from './canvas-perf';
import type { DrawableCanvas } from './drawable-canvas';

/**
 * Drives a {@link DrawableCanvas} with `requestAnimationFrame`, redrawing each
 * frame with the elapsed delta and reporting a smoothed FPS. Returns a stop
 * function that cancels the loop and guarantees no further frames are scheduled,
 * even if `stop` is called from inside a `redraw` for the in-flight frame.
 */
export function startDrawableCanvasAnimationLoop(
  drawableCanvas: Pick<DrawableCanvas, 'redraw'>,
  onFps: (fps: number) => void,
): () => void {
  let previousTime = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let frameId = 0;
  let stopped = false;

  function animate(time: number) {
    if (stopped) {
      return;
    }

    const dt = (time - previousTime) / 1000;
    previousTime = time;
    // Wall-clock gap between frames vs. time spent inside our redraw. The
    // difference is the browser's own layout/paint/composite work, which is the
    // one thing an on-device readout can show that inspecting our code cannot.
    recordCanvasPerf('frame', dt * 1000);
    // Closes the input total for the gap just measured, so `input` is ms per
    // frame and lines up with `frame` rather than being per-event.
    flushCanvasInputSample();
    const jsStart = performance.now();
    drawableCanvas.redraw(dt);
    recordCanvasPerf('js', performance.now() - jsStart);
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

    frameId = requestAnimationFrame(animate);
  }

  frameId = requestAnimationFrame(animate);
  return () => {
    stopped = true;
    cancelAnimationFrame(frameId);
  };
}
