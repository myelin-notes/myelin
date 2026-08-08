import { describe, expect, it } from 'vitest';
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
