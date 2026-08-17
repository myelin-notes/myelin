import { describe, expect, it } from 'vitest';
import {
  BG_OVERDRAW_PX,
  backgroundPanShift,
  createZoomGestureState,
  cullMarginWorld,
  isZoomGestureActive,
} from './canvas-renderer';
import { MAX_ZOOM, MIN_ZOOM } from './canvas-viewport';

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
 * Where the tiling's own origin lands on screen, which is what the grid is
 * drawn from: the layer element starts at -BG_OVERDRAW_PX and the per-frame
 * translate moves it from there.
 */
describe('background tiling origin', () => {
  const TILE_WORLD = 24;

  it('stays anchored to the world origin at every zoom', () => {
    // The world origin is at screen (offset * zoom) and the pattern repeats
    // every tile, so the tiling origin only has to agree with it modulo one
    // tile. -BG_OVERDRAW_PX is a whole number of tiles only when 3/zoom is an
    // integer, so a shift that ignores it leaves a phase error — the grid then
    // slides against the canvas content as the user zooms, which is exactly
    // what the CanvasPattern this layer replaced never did.
    const zooms = [MIN_ZOOM, 0.5, 0.75, 1, 1.3, 1.5, 2, 2.5, MAX_ZOOM];
    for (const zoom of zooms) {
      for (const offset of [0, 37.5, -412.25, 10000]) {
        const tile = TILE_WORLD * zoom;
        const shift = backgroundPanShift(offset * zoom + BG_OVERDRAW_PX, tile);
        const origin = -BG_OVERDRAW_PX + shift;
        const error = Math.abs(
          (((origin - offset * zoom) % tile) + tile) % tile,
        );
        expect(Math.min(error, tile - error)).toBeLessThan(1e-6);
      }
    }
  });

  it('never translates the layer past its overdraw', () => {
    // Folding the overdraw into the shift must not push the translate out of
    // [0, tile) — beyond that the layer's own edge is dragged into view.
    for (const zoom of [MIN_ZOOM, 1, 1.3, MAX_ZOOM]) {
      const tile = TILE_WORLD * zoom;
      const shift = backgroundPanShift(-98765.43 * zoom + BG_OVERDRAW_PX, tile);
      expect(shift).toBeGreaterThanOrEqual(0);
      expect(shift).toBeLessThan(tile);
      expect(tile).toBeLessThanOrEqual(BG_OVERDRAW_PX);
    }
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

describe('cullMarginWorld', () => {
  it('is a constant band in screen pixels, whatever the zoom', () => {
    for (const zoom of [MIN_ZOOM, 0.5, 1, 4, MAX_ZOOM]) {
      expect(cullMarginWorld(zoom) * zoom).toBeCloseTo(128, 6);
    }
  });

  it('shrinks in world units as the view zooms in', () => {
    expect(cullMarginWorld(4)).toBeLessThan(cullMarginWorld(1));
    expect(cullMarginWorld(1)).toBeLessThan(cullMarginWorld(0.25));
  });

  it('culls nothing when the zoom is unusable', () => {
    // Before the viewport has been measured. An unbounded margin keeps every
    // element in the frame, which is the pre-culling behaviour — a bad frame
    // is recoverable, a blank canvas reads as data loss.
    for (const zoom of [0, -1, Number.NaN]) {
      expect(cullMarginWorld(zoom)).toBe(Number.POSITIVE_INFINITY);
    }
  });
});
