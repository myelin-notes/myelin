import { describe, expect, it } from 'vitest';
import { shouldRepaintBackground, shouldTouchLayer } from './canvas-renderer';

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
