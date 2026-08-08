import { describe, expect, it } from 'vitest';
import {
  backgroundPanShift,
  createZoomGestureState,
  isZoomGestureActive,
} from './canvas-renderer';

describe('backgroundPanShift', () => {
  const TILE = 24;

  it('passes a pan smaller than one tile straight through', () => {
    expect(backgroundPanShift(10, TILE)).toBe(10);
  });

  it('wraps a whole tile back to zero', () => {
    // The pattern is periodic, so a whole-tile shift must be indistinguishable
    // from no shift at all — otherwise the layer walks out of its overdraw.
    expect(backgroundPanShift(TILE, TILE)).toBe(0);
    expect(backgroundPanShift(TILE * 5, TILE)).toBe(0);
  });

  it('keeps the remainder of a pan larger than one tile', () => {
    expect(backgroundPanShift(30, TILE)).toBe(6);
    expect(backgroundPanShift(TILE * 3 + 7, TILE)).toBe(7);
  });

  it('maps a negative pan into the positive tile range', () => {
    // JavaScript's % keeps the sign of the dividend, which would translate the
    // layer the wrong way and expose the edge the overdraw was sized for.
    expect(backgroundPanShift(-10, TILE)).toBe(14);
    expect(backgroundPanShift(-30, TILE)).toBe(18);
    expect(backgroundPanShift(-TILE, TILE)).toBe(0);
  });

  it('always lands inside one tile, so the overdraw is never exceeded', () => {
    for (const pan of [0.5, -0.5, 1e6, -1e6, 12345.678, -98765.43]) {
      const shift = backgroundPanShift(pan, TILE);
      expect(shift).toBeGreaterThanOrEqual(0);
      expect(shift).toBeLessThan(TILE);
    }
  });

  it('yields no shift when the tile size or pan is unusable', () => {
    // A zero tile happens at zoom 0 and a non-finite pan at startup, before the
    // viewport has been measured. Neither should produce NaN in a style string.
    expect(backgroundPanShift(10, 0)).toBe(0);
    expect(backgroundPanShift(Number.NaN, TILE)).toBe(0);
    expect(backgroundPanShift(Number.POSITIVE_INFINITY, TILE)).toBe(0);
  });
});

/**
 * The background layer leaves the tree while this reads true, so a false
 * positive flickers the grid and a stuck true loses it until something moves.
 */
describe('isZoomGestureActive', () => {
  /** Advances whole frames at 60fps, which is what the render loop feeds it. */
  const run = (zooms: number[], state = createZoomGestureState()) => {
    let now = 1000;
    return zooms.map((zoom) => {
      now += 16.67;
      return isZoomGestureActive(state, zoom, now);
    });
  };

  it('ignores a single wheel notch', () => {
    // One notch changes the zoom once and is over. Taking the grid down for
    // that would be a flicker on every discrete zoom on a desktop.
    expect(run([1, 1.1, 1.1, 1.1, 1.1, 1.1])).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('goes active once a zoom has been sustained, and stays active', () => {
    const frames = run([1, 1.1, 1.2, 1.3, 1.4, 1.5]);
    expect(frames.slice(0, 2)).toEqual([false, false]);
    expect(frames.slice(2)).toEqual([true, true, true, true]);
  });

  it('holds through a frame that repeats the zoom mid-gesture', () => {
    // A trackpad gesture can miss a frame without having ended; releasing on
    // the first repeated value would drop the grid back in mid-pinch.
    expect(run([1, 1.1, 1.2, 1.3, 1.3, 1.4])).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
  });

  it('releases once the zoom has held still past the settle window', () => {
    const state = createZoomGestureState();
    expect(run([1, 1.1, 1.2, 1.3], state)).toEqual([false, false, true, true]);
    // Same zoom, far enough past the last change to count as settled.
    expect(isZoomGestureActive(state, 1.3, 1_000_000)).toBe(false);
  });

  it('cannot get stuck when the zoom simply stops changing', () => {
    // There is no gesture-end event behind this — an interrupted pinch, a
    // cancelled animation and a released trackpad all look the same, and all
    // have to come back.
    const state = createZoomGestureState();
    run([1, 1.1, 1.2, 1.3, 1.4], state);
    let now = 2000;
    const settled = Array.from({ length: 30 }, () => {
      now += 16.67;
      return isZoomGestureActive(state, 1.4, now);
    });
    expect(settled.at(-1)).toBe(false);
  });
});
