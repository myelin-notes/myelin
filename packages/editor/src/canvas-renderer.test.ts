import { describe, expect, it } from 'vitest';
import { backgroundPanShift, backgroundRasterZoom } from './canvas-renderer';
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

describe('backgroundRasterZoom', () => {
  it('paints at the zoom itself on an exact step', () => {
    // A round zoom is where a user parks, so it is the one that must be painted
    // rather than approached from below and left scaled.
    expect(backgroundRasterZoom(1)).toBe(1);
    expect(backgroundRasterZoom(2)).toBe(2);
    expect(backgroundRasterZoom(0.5)).toBe(0.5);
  });

  it('holds one painting across the zooms between two steps', () => {
    // The whole point: a run of zoom frames inside one step must reuse a single
    // painted tiling, or the layer repaints every frame the way it used to.
    const inside = [1.05, 1.2, 1.3, 1.41];
    for (const zoom of inside) {
      expect(backgroundRasterZoom(zoom)).toBeCloseTo(1);
    }
  });

  it('never scales the layer down, at any zoom the viewport allows', () => {
    // A scale below 1 shrinks the layer away from the viewport edges it was
    // sized to cover, and the overdraw only accounts for growth.
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 0.01) {
      const scale = zoom / backgroundRasterZoom(zoom);
      expect(scale).toBeGreaterThanOrEqual(1);
      // And never soft enough to look like a different pattern.
      expect(scale).toBeLessThan(Math.SQRT2 + 1e-9);
    }
  });

  it('falls back to 1 for a zoom that is not a usable number', () => {
    // Read before the viewport has been measured; a NaN here would reach a
    // style string as `background-size: NaNpx`.
    expect(backgroundRasterZoom(0)).toBe(1);
    expect(backgroundRasterZoom(Number.NaN)).toBe(1);
    expect(backgroundRasterZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
