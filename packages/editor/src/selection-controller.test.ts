import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DrawableElement,
  getResizeHandles,
  ResizeHandles,
} from './elements/drawable-element';
import { SelectionController } from './selection-controller';

function createElement(uuid: string, bounds: DOMRect): DrawableElement {
  let selected = false;
  return {
    uuid,
    get isSelected() {
      return selected;
    },
    get boundingBox() {
      return bounds;
    },
    resizeHandles: ResizeHandles.All,
    hidden: false,
    getHandles() {
      return getResizeHandles(bounds, ResizeHandles.All);
    },
    select() {
      selected = true;
    },
    unselect() {
      selected = false;
    },
  } as DrawableElement;
}

afterEach(() => vi.unstubAllGlobals());

describe('SelectionController', () => {
  it('owns selection and derives its shared bounds without a canvas', () => {
    const first = createElement('first', new DOMRect(10, 20, 30, 40));
    const second = createElement('second', new DOMRect(-5, 50, 20, 10));
    const controller = new SelectionController(() => [first, second]);

    controller.selectByUuid(['first', 'second']);

    expect(controller.selectedElements).toEqual([first, second]);
    expect(controller.getBounds()).toEqual(new DOMRect(-5, 20, 45, 40));

    controller.clear();
    expect(controller.selectedElements).toEqual([]);
  });

  it('gives small selections screen-space targets for each pointer type', () => {
    const element = createElement('small', new DOMRect(10, 20, 2, 4));
    const controller = new SelectionController(() => [element]);
    controller.selectAll();

    expect(controller.getInteractionBounds(2, 'touch')).toEqual(
      new DOMRect(0, 11, 22, 22),
    );
    expect(controller.getInteractionBounds(2, 'pen')).toEqual(
      new DOMRect(4, 15, 14, 14),
    );
    expect(controller.getInteractionBounds(2, 'mouse')).toEqual(
      new DOMRect(6, 17, 10, 10),
    );
    expect(controller.hitHandle({ x: 11, y: 22 }, 1, 'touch')).toBeNull();
    expect(controller.hitHandle({ x: -5, y: 6 }, 1, 'touch')?.position).toEqual(
      { x: 6, y: 16 },
    );
    expect(controller.shouldUseSelectToolForTouch({ x: 11, y: 2 }, 1)).toBe(
      true,
    );
  });

  it('uses one corner-handle set for a multi-selection', () => {
    const first = createElement('first', new DOMRect(0, 0, 20, 20));
    const second = createElement('second', new DOMRect(80, 40, 20, 20));
    const controller = new SelectionController(() => [first, second]);
    controller.selectAll();

    const corners = [
      { x: -4, y: -4 },
      { x: 104, y: -4 },
      { x: -4, y: 64 },
      { x: 104, y: 64 },
    ];

    for (const corner of corners) {
      expect(controller.hitHandle(corner, 1, 'mouse')?.position).toEqual(
        corner,
      );
    }
    expect(controller.hitHandle({ x: 50, y: -4 }, 1, 'mouse')).toBeNull();
  });

  it('owns one animation for the current selection membership', () => {
    const first = createElement('first', new DOMRect(0, 0, 20, 20));
    const second = createElement('second', new DOMRect(40, 0, 20, 20));
    const controller = new SelectionController(() => [first, second]);
    first.select();

    controller.advanceOverlay(0.016);
    expect(controller.hasOverlay).toBe(true);

    second.select();
    controller.advanceOverlay(0);
    expect(controller.hasOverlay).toBe(false);

    controller.advanceOverlay(0.016);
    expect(controller.hasOverlay).toBe(true);
  });

  it('draws subtle member outlines within one shared multi-selection envelope', () => {
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: () => '',
    }));
    const first = createElement('first', new DOMRect(0, 0, 20, 20));
    const second = createElement('second', new DOMRect(80, 40, 20, 20));
    const unselected = createElement('unselected', new DOMRect(40, 20, 20, 20));
    const controller = new SelectionController(() => [
      first,
      unselected,
      second,
    ]);
    controller.selectByUuid(['first', 'second']);
    const roundRect = vi.fn();
    const ctx = {
      beginPath: vi.fn(),
      fill: vi.fn(),
      roundRect,
      setLineDash: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    controller.advanceOverlay(1);
    controller.drawOverlay(ctx, null, 1);

    expect(roundRect).toHaveBeenCalledTimes(12);
    expect(roundRect).toHaveBeenCalledWith(0, 0, 20, 20, 2);
    expect(roundRect).toHaveBeenCalledWith(80, 40, 20, 20, 2);
    expect(roundRect).not.toHaveBeenCalledWith(40, 20, 20, 20, 2);
  });
});
