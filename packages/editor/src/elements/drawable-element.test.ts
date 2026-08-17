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

/**
 * The renderer draws only the elements this reports as visible, so anything it
 * answers `false` for is invisible that frame no matter what it would paint.
 */
describe('intersectsWorldRect', () => {
  const VIEW = new DOMRect(0, 0, 100, 100);

  function strokeAt(x: number, y: number): StrokeElement {
    const stroke = new StrokeElement(
      'k',
      [x, y, 0.5, x + 4, y + 4, 0.5, x + 8, y, 0.5],
      false,
      STYLE,
    );
    stroke.updateBounds();
    return stroke;
  }

  it('keeps an element inside the view', () => {
    expect(strokeAt(40, 40).intersectsWorldRect(VIEW, 0)).toBe(true);
  });

  it('keeps one that only overlaps an edge', () => {
    expect(strokeAt(-4, 50).intersectsWorldRect(VIEW, 0)).toBe(true);
  });

  it('drops one well outside on either axis', () => {
    expect(strokeAt(500, 50).intersectsWorldRect(VIEW, 0)).toBe(false);
    expect(strokeAt(50, -500).intersectsWorldRect(VIEW, 0)).toBe(false);
  });

  it('keeps one just outside when a margin is allowed for', () => {
    const stroke = strokeAt(140, 50);
    expect(stroke.intersectsWorldRect(VIEW, 0)).toBe(false);
    expect(stroke.intersectsWorldRect(VIEW, 128)).toBe(true);
  });

  it('follows the element offset rather than its local geometry', () => {
    // Local coordinates put this one in view; the offset is what actually
    // decides where it lands, and a test that ignored it would cull visible ink.
    const stroke = strokeAt(10, 10);
    stroke.setOffset(1000, 1000);
    expect(stroke.intersectsWorldRect(VIEW, 0)).toBe(false);

    stroke.setOffset(0, 0);
    expect(stroke.intersectsWorldRect(VIEW, 0)).toBe(true);
  });
});
