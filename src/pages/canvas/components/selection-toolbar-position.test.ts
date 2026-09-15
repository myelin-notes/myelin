import { describe, expect, it } from 'vitest';
import { getSelectionToolbarPosition } from './selection-toolbar-position';

describe('selection toolbar position', () => {
  it('stays inside a canvas pane offset from the window edges', () => {
    expect(
      getSelectionToolbarPosition({
        selectionBounds: { left: 300, top: 540, width: 200, height: 200 },
        viewport: { left: 0, top: 0, width: 800, height: 560 },
        toolbarSize: { width: 240, height: 48 },
        viewportMargin: 12,
        selectionGap: 10,
      }),
    ).toEqual({ left: 280, top: 482 });
  });

  it('honors a visual viewport inset within the canvas', () => {
    expect(
      getSelectionToolbarPosition({
        selectionBounds: { left: 0, top: 0, width: 40, height: 40 },
        viewport: { left: 18, top: 24, width: 360, height: 500 },
        toolbarSize: { width: 160, height: 48 },
        viewportMargin: 12,
        selectionGap: 10,
      }),
    ).toEqual({ left: 30, top: 50 });
  });
});
