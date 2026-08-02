import { describe, expect, it } from 'vitest';
import {
  backgroundPanShift,
  shouldRepaintBackground,
  shouldTouchLayer,
} from './canvas-renderer';

describe('backgroundPanShift', () => {
  it('passes a pan shorter than one tile straight through', () => {
    expect(backgroundPanShift(7, 24)).toBe(7);
  });

  it('never exceeds the one tile of slack the paint leaves beyond the edge', () => {
    // The whole safety property: whatever the pan, the compositor is only ever
    // asked to slide in pixels that were actually rasterized.
    for (const pan of [-10_000, -25, -1, 0, 1, 25, 999, 10_000]) {
      const shift = backgroundPanShift(pan, 24);
      expect(shift).toBeGreaterThanOrEqual(0);
      expect(shift).toBeLessThan(24);
    }
  });

  it('reduces a long pan to the same shift as the equivalent short one', () => {
    // Exactness rests on this: tiles are interchangeable, so dropping whole
    // tiles has to leave the visible result identical.
    expect(backgroundPanShift(24 * 41 + 7, 24)).toBeCloseTo(
      backgroundPanShift(7, 24),
    );
  });

  it('wraps a pan in the negative direction into the painted slack', () => {
    expect(backgroundPanShift(-7, 24)).toBe(17);
  });

  it('holds the grid still when the pan lands on a whole number of tiles', () => {
    expect(backgroundPanShift(-48, 24)).toBe(0);
  });

  it('yields no shift for a degenerate tile rather than NaN', () => {
    // A zero or non-finite tile would otherwise put NaN into a CSS transform,
    // which drops the whole declaration and strands the layer mid-pan.
    expect(backgroundPanShift(10, 0)).toBe(0);
    expect(backgroundPanShift(Number.NaN, 24)).toBe(0);
  });
});

describe('shouldTouchLayer', () => {
  it('skips a layer that is empty and stays empty', () => {
    // The case that matters: panning a blank canvas must not clear a
    // full-viewport texture just to draw nothing into it.
    expect(shouldTouchLayer(false, false)).toBe(false);
  });

  it('paints when there is something to paint', () => {
    expect(shouldTouchLayer(true, false)).toBe(true);
    expect(shouldTouchLayer(true, true)).toBe(true);
  });

  it('still runs the frame that has to clear what was there before', () => {
    // Deselecting leaves stale pixels on the overlay; skipping here would
    // strand them on screen.
    expect(shouldTouchLayer(false, true)).toBe(true);
  });
});

describe('shouldRepaintBackground', () => {
  const base = {
    stale: false,
    viewMoved: false,
    willPaint: true,
    hasContent: true,
  };

  it('repaints when the view moves', () => {
    expect(shouldRepaintBackground({ ...base, viewMoved: true })).toBe(true);
  });

  it('leaves the grid alone when only elements changed', () => {
    // Drawing a stroke must not re-upload the background texture.
    expect(shouldRepaintBackground(base)).toBe(false);
  });

  it('repaints when a theme or background-pref swap marked it stale', () => {
    expect(shouldRepaintBackground({ ...base, stale: true })).toBe(true);
  });

  it('clears once when the background is switched to blank', () => {
    expect(
      shouldRepaintBackground({ ...base, willPaint: false, hasContent: true }),
    ).toBe(true);
  });

  it('does nothing further once blank has been cleared', () => {
    expect(
      shouldRepaintBackground({
        stale: false,
        viewMoved: true,
        willPaint: false,
        hasContent: false,
      }),
    ).toBe(false);
  });

  it('paints the first frame after the grid is turned back on', () => {
    expect(
      shouldRepaintBackground({
        stale: false,
        viewMoved: false,
        willPaint: true,
        hasContent: false,
      }),
    ).toBe(true);
  });
});
