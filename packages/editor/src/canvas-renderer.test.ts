import { describe, expect, it } from 'vitest';
import { backgroundPanShift } from './canvas-renderer';

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
