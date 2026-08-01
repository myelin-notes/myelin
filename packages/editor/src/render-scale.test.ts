import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canvasLogicalSize,
  renderScale,
  setMaxDevicePixelRatio,
} from './render-scale';

function setDevicePixelRatio(value: number): void {
  (globalThis as { window?: unknown }).window = { devicePixelRatio: value };
}

describe('render scale', () => {
  beforeEach(() => {
    setDevicePixelRatio(2);
  });

  afterEach(() => {
    setMaxDevicePixelRatio(Number.POSITIVE_INFINITY);
    // Left as undefined rather than removed, so `typeof window === 'undefined'`
    // guards elsewhere still see no browser.
    (globalThis as { window?: unknown }).window = undefined;
  });

  it('uses the device ratio when uncapped', () => {
    expect(renderScale()).toBe(2);
  });

  it('caps the device ratio', () => {
    setMaxDevicePixelRatio(1);
    expect(renderScale()).toBe(1);
  });

  it('never scales up past the device ratio', () => {
    setMaxDevicePixelRatio(4);
    expect(renderScale()).toBe(2);
  });

  it('converts a backing store to logical pixels at the capped scale', () => {
    // The bug this guards: a canvas sized at the cap but measured against the
    // raw device ratio reports a viewport a third too small on an iPad, which
    // mis-centers fit-to-frame, pan clamping, and viewport-center placement.
    setMaxDevicePixelRatio(1.5);
    const canvas = {
      width: 1024 * 1.5,
      height: 768 * 1.5,
    } as HTMLCanvasElement;
    expect(canvasLogicalSize(canvas)).toEqual({ width: 1024, height: 768 });
  });
});
