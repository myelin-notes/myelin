import { describe, expect, it } from 'vitest';
import { mapPmRectToScreen } from './screen-rect';

describe('mapPmRectToScreen', () => {
  // frame is the real on-screen box (contentWidth * zoom); content is the
  // un-zoomed PM-space box. The width ratio recovers the zoom/dpr scale, and
  // the frame origin re-anchors coords wherever the canvas sits in the window.
  it('re-anchors PM coords onto the frame regardless of canvas offset', () => {
    // dpr=2: content box reported at half the on-screen size.
    const frameRect = { left: 300, top: 100, width: 800, height: 1000 };
    const contentRect = { left: 150, top: 50, width: 400, height: 500 };

    expect(
      mapPmRectToScreen(frameRect, contentRect, {
        left: 170,
        top: 60,
        right: 190,
        bottom: 80,
      }),
    ).toEqual({
      left: 300 + (170 - 150) * 2,
      right: 300 + (190 - 150) * 2,
      top: 100 + (60 - 50) * 2,
      bottom: 100 + (80 - 50) * 2,
      width: 40,
      height: 40,
    });
  });

  it('falls back to scale 1 when the content box is degenerate', () => {
    const frameRect = { left: 0, top: 0, width: 0, height: 0 };
    const contentRect = { left: 0, top: 0, width: 0, height: 0 };

    expect(
      mapPmRectToScreen(frameRect, contentRect, {
        left: 5,
        top: 5,
        right: 9,
        bottom: 13,
      }),
    ).toEqual({
      left: 5,
      right: 9,
      top: 5,
      bottom: 13,
      width: 4,
      height: 8,
    });
  });
});
