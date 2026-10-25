import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDrawableCanvasAnimationLoop } from './render-loop';

describe('startDrawableCanvasAnimationLoop', () => {
  let nextFrameId = 1;
  let scheduledFrames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    nextFrameId = 1;
    scheduledFrames = new Map();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const frameId = nextFrameId++;
        scheduledFrames.set(frameId, callback);
        return frameId;
      }),
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((frameId: number) => {
        scheduledFrames.delete(frameId);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function runFrame(time: number) {
    const entries = Array.from(scheduledFrames.entries());
    expect(entries).toHaveLength(1);
    const [frameId, callback] = entries[0];
    scheduledFrames.delete(frameId);
    callback(time);
  }

  function createCanvas(redraw: (dt: number) => boolean = () => false) {
    let scheduler: (() => void) | null = null;
    return {
      redraw: vi.fn(redraw),
      setRedrawScheduler: vi.fn((next: (() => void) | null) => {
        scheduler = next;
      }),
      request: () => scheduler?.(),
      get scheduler() {
        return scheduler;
      },
    };
  }

  it('draws one frame on start, then idles until a redraw is requested', () => {
    const canvas = createCanvas();
    startDrawableCanvasAnimationLoop(canvas, vi.fn());

    runFrame(16);
    expect(canvas.redraw).toHaveBeenCalledTimes(1);
    expect(scheduledFrames.size).toBe(0);

    canvas.request();
    runFrame(500);
    expect(canvas.redraw).toHaveBeenCalledTimes(2);
    expect(scheduledFrames.size).toBe(0);
  });

  it('coalesces requests made before the next frame', () => {
    const canvas = createCanvas();
    startDrawableCanvasAnimationLoop(canvas, vi.fn());
    runFrame(16);

    canvas.request();
    canvas.request();
    canvas.request();
    expect(scheduledFrames.size).toBe(1);
  });

  it('keeps drawing while redraw reports an animation, with a zero delta after idle', () => {
    let frames = 0;
    const canvas = createCanvas(() => ++frames < 3);
    startDrawableCanvasAnimationLoop(canvas, vi.fn());

    runFrame(1000);
    runFrame(1016);
    runFrame(1032);

    expect(canvas.redraw.mock.calls.map(([dt]) => dt)).toEqual([
      0, 0.016, 0.016,
    ]);
    expect(scheduledFrames.size).toBe(0);

    canvas.request();
    runFrame(5000);
    expect(canvas.redraw).toHaveBeenLastCalledWith(0);
  });

  it('draws again when a redraw is requested from inside a frame', () => {
    const canvas = createCanvas(() => {
      if (canvas.redraw.mock.calls.length === 1) {
        canvas.request();
      }
      return false;
    });
    startDrawableCanvasAnimationLoop(canvas, vi.fn());

    runFrame(16);
    runFrame(32);
    expect(canvas.redraw).toHaveBeenCalledTimes(2);
    expect(scheduledFrames.size).toBe(0);
  });

  it('does not reschedule after stop is called during an in-flight frame', () => {
    let stopAnimation = () => {};
    const canvas = createCanvas(() => {
      stopAnimation();
      return true;
    });
    stopAnimation = startDrawableCanvasAnimationLoop(canvas, vi.fn());

    runFrame(16);

    expect(canvas.redraw).toHaveBeenCalledTimes(1);
    expect(scheduledFrames.size).toBe(0);
    expect(canvas.scheduler).toBeNull();
    canvas.request();
    expect(scheduledFrames.size).toBe(0);
  });
});
