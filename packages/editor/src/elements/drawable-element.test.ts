import { describe, expect, it } from 'vitest';
import { HANDLE_TOUCH_HIT_RADIUS } from './drawable-element';
import { StrokeElement, type StrokeStyle } from './stroke-element';

const STYLE: StrokeStyle = { color: '#191c1e', size: 8 };
/** Swallows every drawing call — the tests only care about the ramp `draw` advances. */
const CTX = new Proxy(
  {},
  { get: () => () => undefined },
) as CanvasRenderingContext2D;

/**
 * The renderer skips the whole overlay canvas — clear included — on frames
 * where no element would draw into it, so this predicate has to agree with
 * `drawSelectionOverlay`'s own early return or the outline goes missing.
 */
describe('hasSelectionOverlay', () => {
  it('is false until an element is both selected and drawn', () => {
    const stroke = new StrokeElement('s1', [], false, STYLE);
    expect(stroke.hasSelectionOverlay).toBe(false);

    // Selection starts the outline's ramp at zero; it is the next draw that
    // advances it, which is why the renderer reads this after drawing.
    stroke.select();
    expect(stroke.hasSelectionOverlay).toBe(false);

    stroke.draw(CTX, 0.016);
    expect(stroke.hasSelectionOverlay).toBe(true);
  });

  it('is false again as soon as the element is unselected', () => {
    const stroke = new StrokeElement('s2', [], false, STYLE);
    stroke.select();
    stroke.draw(CTX, 0.016);

    stroke.unselect();
    expect(stroke.hasSelectionOverlay).toBe(false);
  });

  it('is false for a hidden element, even a selected one', () => {
    const stroke = new StrokeElement('s3', [], false, STYLE);
    stroke.select();
    stroke.draw(CTX, 0.016);

    stroke.hidden = true;
    expect(stroke.hasSelectionOverlay).toBe(false);
  });
});

describe('hitHandle', () => {
  it('reaches a handle a fingertip away only when touch is requested', () => {
    const stroke = new StrokeElement(
      'h1',
      [0, 0, 0.5, 100, 80, 0.5],
      false,
      STYLE,
    );
    stroke.updateBounds();
    const handle = stroke.getHandles()[0];
    // 15px out at zoom 1: past the mouse radius, inside the touch one, and far
    // from any neighbouring handle (the box is ~100x80).
    const point = { x: handle.position.x + 15, y: handle.position.y };

    expect(stroke.hitHandle(point, 1)).toBeNull();
    expect(stroke.hitHandle(point, 1, true)?.position).toEqual(handle.position);
  });

  it('picks the nearest handle when a small element makes several ambiguous', () => {
    const stroke = new StrokeElement(
      'h2',
      [0, 0, 0.5, 8, 8, 0.5],
      false,
      STYLE,
    );
    stroke.updateBounds();
    const handles = stroke.getHandles();
    // Bottom-right corner: last in the handle order, so first-match-wins would
    // answer with one of the edge handles the radius also covers.
    const corner = handles.reduce((a, b) =>
      b.position.x + b.position.y > a.position.x + a.position.y ? b : a,
    );
    const inRange = handles.filter(
      (h) =>
        Math.hypot(
          h.position.x - corner.position.x,
          h.position.y - corner.position.y,
        ) <= HANDLE_TOUCH_HIT_RADIUS,
    );

    expect(inRange.length).toBeGreaterThan(1);
    expect(stroke.hitHandle(corner.position, 1, true)?.position).toEqual(
      corner.position,
    );
  });
});
