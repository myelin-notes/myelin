import { describe, expect, it } from 'vitest';
import { PX_PER_CM, Ruler } from './ruler';

// show() over this view: 16 cm long, 2 cm wide, centred at (500, 250).
const VIEW = new DOMRect(0, 0, 1000, 500);
const HALF = 8 * PX_PER_CM;
const HALF_WIDTH = PX_PER_CM;

describe('Ruler', () => {
  it('resizes from one end without moving the other', () => {
    const ruler = new Ruler();
    ruler.show(VIEW);
    const start = 500 - HALF;
    const end = 500 + HALF;

    ruler.beginDrag({ x: end - 2, y: 250 }, 1);
    ruler.dragTo({ x: end - 102, y: 250 });
    ruler.endDrag();
    expect(ruler.hit({ x: start + 2, y: 250 }, 1)).toBe('start');
    expect(ruler.hit({ x: end - 102, y: 250 }, 1)).toBe('end');
    expect(ruler.hit({ x: end - 2, y: 250 }, 1)).toBeNull();

    // Can't be shrunk past its minimum, or flipped by dragging past the far end.
    ruler.beginDrag({ x: end - 102, y: 250 }, 1);
    ruler.dragTo({ x: start - 500, y: 250 });
    expect(ruler.hit({ x: start + 2, y: 250 }, 1)).toBe('start');
    expect(ruler.hit({ x: start + 3 * PX_PER_CM, y: 250 }, 1)).toBe('end');
  });

  it('snaps a near-quarter turn to 90° and carries its edges with it', () => {
    const ruler = new Ruler();
    ruler.show(VIEW);
    const knob = { x: 500 + HALF - HALF_WIDTH, y: 250 };

    ruler.beginDrag(knob, 1);
    expect(ruler.hit(knob, 1)).toBe('rotate');
    ruler.dragTo({ x: 505, y: 550 });
    ruler.endDrag();

    // Turned clockwise, the top edge now faces +x.
    expect(ruler.edgeAt({ x: 500 + HALF_WIDTH + 5, y: 300 }, 1)).toBe(-1);
    const projected = ruler.projectToEdge({ x: 530, y: 320 }, -1, 4);
    expect(projected.x).toBeCloseTo(500 + HALF_WIDTH + 4);
    expect(projected.y).toBeCloseTo(320);
  });
});
