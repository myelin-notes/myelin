import { describe, expect, it } from 'vitest';
import { getToolbarPanelTop } from './toolbar-panel-position';

// A 1024x640 tablet with a 38px nav bar and the tab bar above the canvas.
const CANVAS = { left: 0, top: 62, right: 1024, bottom: 602 };

describe('toolbar panel top', () => {
  it('keeps its anchor when the panel fits', () => {
    expect(
      getToolbarPanelTop({
        desiredTop: 200,
        panelHeight: 300,
        bounds: CANVAS,
        margin: 16,
      }),
    ).toBe(200);
  });

  it('moves up so the bottom stays clear of the canvas edge', () => {
    expect(
      getToolbarPanelTop({
        desiredTop: 213,
        panelHeight: 400,
        bounds: CANVAS,
        margin: 16,
      }),
    ).toBe(186);
  });

  it('pins to the top when the panel is taller than the canvas', () => {
    expect(
      getToolbarPanelTop({
        desiredTop: 213,
        panelHeight: 700,
        bounds: CANVAS,
        margin: 16,
      }),
    ).toBe(78);
  });
});
