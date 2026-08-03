import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM } from './canvas-viewport';
import { quantizeRasterZoom } from './raster-zoom';

describe('quantizeRasterZoom', () => {
  it('paints at the zoom itself on an exact step', () => {
    // A round zoom is where a user parks, so it is the one that must be painted
    // rather than approached from below and left scaled.
    expect(quantizeRasterZoom(1)).toBe(1);
    expect(quantizeRasterZoom(2)).toBe(2);
    expect(quantizeRasterZoom(0.5)).toBe(0.5);
  });

  it('holds one painting across the zooms between two steps', () => {
    // The whole point: a run of zoom frames inside one step must reuse a single
    // painted tiling, or the layer repaints every frame the way it used to.
    const inside = [1.05, 1.2, 1.3, 1.41];
    for (const zoom of inside) {
      expect(quantizeRasterZoom(zoom)).toBeCloseTo(1);
    }
  });

  it('never scales the layer down, at any zoom the viewport allows', () => {
    // A scale below 1 shrinks the layer away from the viewport edges it was
    // sized to cover, and the overdraw only accounts for growth.
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 0.01) {
      const scale = zoom / quantizeRasterZoom(zoom);
      expect(scale).toBeGreaterThanOrEqual(1);
      // And never soft enough to look like a different pattern.
      expect(scale).toBeLessThan(Math.SQRT2 + 1e-9);
    }
  });

  it('falls back to 1 for a zoom that is not a usable number', () => {
    // Read before the viewport has been measured; a NaN here would reach a
    // style string as `background-size: NaNpx`.
    expect(quantizeRasterZoom(0)).toBe(1);
    expect(quantizeRasterZoom(Number.NaN)).toBe(1);
    expect(quantizeRasterZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
