import { describe, expect, it, vi } from 'vitest';
import { startDrawableCanvasAnimationLoop } from './render-loop';

describe('startDrawableCanvasAnimationLoop', () => {
  it('does not reschedule after stop is called during an in-flight frame', () => {
    let nextFrameId = 1;
    const scheduledFrames = new Map<number, FrameRequestCallback>();

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

    let stopAnimation = () => {};
    const drawableCanvas = {
      redraw: vi.fn(() => {
        stopAnimation();
      }),
    };

    stopAnimation = startDrawableCanvasAnimationLoop(drawableCanvas, vi.fn());

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(scheduledFrames.size).toBe(1);

    const [frameId, frameCallback] = Array.from(scheduledFrames.entries())[0];
    scheduledFrames.delete(frameId);
    frameCallback(16);

    expect(drawableCanvas.redraw).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(frameId);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(scheduledFrames.size).toBe(0);
  });
});
