import { describe, expect, it } from 'vitest';
import { isCanvasDoubleTap } from './use-inserts';

describe('isCanvasDoubleTap', () => {
  it('accepts natural timing and position drift between tablet taps', () => {
    expect(
      isCanvasDoubleTap(
        { t: 1_000, x: 100, y: 100 },
        { t: 1_350, x: 115, y: 100 },
      ),
    ).toBe(true);
  });

  it('rejects clicks outside the time or position tolerance', () => {
    const previous = { t: 1_000, x: 100, y: 100 };

    expect(isCanvasDoubleTap(previous, { t: 1_401, x: 100, y: 100 })).toBe(
      false,
    );
    expect(isCanvasDoubleTap(previous, { t: 1_100, x: 117, y: 100 })).toBe(
      false,
    );
  });
});
