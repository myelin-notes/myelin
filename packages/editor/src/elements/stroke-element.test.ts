import { describe, expect, it } from 'vitest';
import { YDocManager } from '../ydoc-manager';
import { ElementType } from './element-type';
import {
  appendStrokeOutline,
  StrokeElement,
  type StrokeStyle,
} from './stroke-element';

const STYLE: StrokeStyle = { color: '#191c1e', size: 8 };
const CTX = {} as CanvasRenderingContext2D;

describe('StrokeElement points', () => {
  it('accumulates points in a flat buffer', () => {
    const s = new StrokeElement('s1', [], false, STYLE);
    s.addPoint(0, 0, 0.5);
    s.addPoint(10, 0, 0.5);
    s.addPoint(10, 10, 0.5);
    expect(s.xyPoints).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it('persists points as a single flat Y.Map value and round-trips', () => {
    const s = new StrokeElement('s2', [], false, STYLE);
    s.addPoint(0, 0, 0.5);
    s.addPoint(100, 0, 0.5);
    s.addPoint(100, 50, 0.5);

    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.STROKE, 's2', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      ...s.getYMapProps(),
    });

    // Stored as one plain array value, not a Y.Array of 3N items.
    expect(Array.isArray(yMap.get('points'))).toBe(true);

    s.bindToYMap(yMap);
    s.commit();

    const reloaded = new StrokeElement('s2', [], false, {
      color: 'x',
      size: 1,
    });
    reloaded.bindToYMap(yMap);
    expect(reloaded.xyPoints).toEqual([
      [0, 0],
      [100, 0],
      [100, 50],
    ]);
    expect(reloaded.localBoundingBox.width).toBeGreaterThan(0);
    expect(reloaded.localBoundingBox.height).toBeGreaterThan(0);
  });

  it('keeps simulated pressure while every sample is the sensorless 0.5', () => {
    const s = new StrokeElement('p1', [], false, STYLE);
    s.addPoint(0, 0, 0.5);
    s.addPoint(10, 0, 0.5);
    s.addPoint(20, 0, undefined);
    expect(s.pressureEnabled).toBe(false);
  });

  it('switches to recorded pressure once a sample proves a real sensor', () => {
    const s = new StrokeElement('p2', [], false, STYLE);
    s.addPoint(0, 0, 0.5);
    s.addPoint(10, 0, 0.82);
    expect(s.pressureEnabled).toBe(true);
  });

  it('persists a mid-stroke pressure switch to the Y.Map', () => {
    const s = new StrokeElement('p3', [], false, STYLE);
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.STROKE, 'p3', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      ...s.getYMapProps(),
    });
    // Bound before the sensor is detected, as the pen tool binds on pointerdown.
    s.bindToYMap(yMap);
    expect(yMap.get('hasPressure')).toBe(false);

    s.addPoint(0, 0, 0.3);
    s.addPoint(10, 0, 0.9);
    s.commit();

    expect(yMap.get('hasPressure')).toBe(true);
  });

  it('persists a replacement point buffer', () => {
    const s = new StrokeElement(
      'p4',
      [0, 0, 0.2, 10, 0, 0.4, 20, 0, 0.6],
      true,
      STYLE,
    );
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.STROKE, 'p4', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      ...s.getYMapProps(),
    });
    s.bindToYMap(yMap);

    s.replacePoints([0, 0, 0.2, 20, 0, 0.6]);

    expect(yMap.get('points')).toEqual([0, 0, 0.2, 20, 0, 0.6]);
  });

  it('hit-tests against the centerline inflated by the stroke half-width', () => {
    const s = new StrokeElement('s3', [], false, { color: '#000', size: 8 });
    s.addPoint(0, 0, 0.5);
    s.addPoint(100, 0, 0.5);
    s.updateBounds();

    // On the centerline.
    expect(s.isOver(50, 0, 1, CTX)).toBe(true);
    // Off the centerline but within radius(2) + halfWidth(4) = 6.
    expect(s.isOver(50, 5, 2, CTX)).toBe(true);
    // Well outside.
    expect(s.isOver(50, 100, 2, CTX)).toBe(false);
  });
});

describe('appendStrokeOutline', () => {
  function recordingSink() {
    const calls: string[] = [];
    return {
      calls,
      moveTo: (x: number, y: number) => calls.push(`M ${x},${y}`),
      quadraticCurveTo: (cx: number, cy: number, x: number, y: number) =>
        calls.push(`Q ${cx},${cy} ${x},${y}`),
      closePath: () => calls.push('Z'),
    };
  }

  it('draws each curve to the midpoint, reflecting the previous control point', () => {
    const sink = recordingSink();

    appendStrokeOutline(sink, [
      [0, 0],
      [10, 10],
      [20, 0],
      [30, 10],
      [40, 0],
    ]);

    expect(sink.calls).toEqual([
      'M 0,0',
      // Control is the second point; the curve ends between it and the third.
      'Q 10,10 15,5',
      // 2 * (15,5) - (10,10) = (20,0), the previous control reflected.
      'Q 20,0 25,5',
      // 2 * (25,5) - (20,0) = (30,10).
      'Q 30,10 35,5',
      'Z',
    ]);
  });

  it('leaves the path untouched for an outline too short to curve', () => {
    const sink = recordingSink();

    appendStrokeOutline(sink, [
      [0, 0],
      [10, 10],
      [20, 0],
    ]);

    expect(sink.calls).toEqual([]);
  });
});

// `updateBoundingBox` only runs when a stroke is finished, but the renderer culls by the bounding
// box every frame — so the box has to track the ink as it is drawn.
describe('StrokeElement live bounds', () => {
  const VIEW = new DOMRect(0, 0, 1000, 1000);

  it.each([
    { name: 'dot', points: [0, 0, 0.5] },
    { name: 'short line', points: [0, 0, 0.5, 0.8, 0.8, 0.5] },
  ])('keeps a thin $name within its maximum start radius', ({ points }) => {
    const s = new StrokeElement('short', points, true, { ...STYLE, size: 1 });
    s.updateBounds();

    expect(s.localBoundingBox.left).toBeGreaterThanOrEqual(-0.75);
    expect(s.localBoundingBox.top).toBeGreaterThanOrEqual(-0.75);
  });

  it.each([
    0, 0.5, 1,
  ])('keeps the tip at the latest sample with stabilization %s', (stabilization) => {
    const s = new StrokeElement('tip', [], true, {
      ...STYLE,
      stabilization,
    });
    s.addPoint(0, 0, 0.5);
    for (const x of [20, 40, 60]) {
      s.addPoint(x, 0, 0.5);
      s.updateBounds();
      expect(s.localBoundingBox.right).toBeCloseTo(x + STYLE.size / 2, 1);
    }
  });

  it.each([
    0, 0.5, 1,
  ])('keeps the tip at the latest sample through a turn with stabilization %s', (stabilization) => {
    const s = new StrokeElement('turn', [], true, {
      ...STYLE,
      stabilization,
    });
    s.addPoint(0, 0, 0.5);
    s.addPoint(20, 0, 0.5);
    s.addPoint(40, 0, 0.5);
    s.addPoint(40, 30, 0.5);
    s.updateBounds();

    expect(s.localBoundingBox.bottom).toBeCloseTo(30 + STYLE.size / 2, 1);
  });

  it('covers the first sample of a stroke', () => {
    const s = new StrokeElement('live1', [], false, STYLE);
    expect(s.intersectsWorldRect(VIEW, 0)).toBe(true);

    s.addPoint(500, 500, 0.5);
    expect(s.localBoundingBox.width).toBeGreaterThan(0);
    expect(s.intersectsWorldRect(VIEW, 0)).toBe(true);
  });

  it('grows to hold every sample as the stroke is drawn', () => {
    const s = new StrokeElement('live2', [], false, STYLE);
    s.addPoint(100, 100, 0.5);
    s.addPoint(200, 400, 0.5);
    s.addPoint(50, 250, 0.5);

    const box = s.localBoundingBox;
    expect(box.x).toBeLessThanOrEqual(50);
    expect(box.y).toBeLessThanOrEqual(100);
    expect(box.right).toBeGreaterThanOrEqual(200);
    expect(box.bottom).toBeGreaterThanOrEqual(400);
  });

  it('stays a superset of the finished outline', () => {
    // The live box pads by the stroke size because it cannot know the outline yet. Too small and the
    // finished stroke would be clipped; this pins the direction of the error.
    const s = new StrokeElement('live3', [], false, STYLE);
    for (let i = 0; i < 40; i++) {
      s.addPoint(100 + i * 5, 300 + Math.sin(i / 3) * 40, 0.5);
    }
    const live = s.localBoundingBox;

    s.updateBounds();
    const finished = s.localBoundingBox;

    expect(live.x).toBeLessThanOrEqual(finished.x);
    expect(live.y).toBeLessThanOrEqual(finished.y);
    expect(live.right).toBeGreaterThanOrEqual(finished.right);
    expect(live.bottom).toBeGreaterThanOrEqual(finished.bottom);
  });

  it('does not stretch back to the origin for a stroke drawn far from it', () => {
    // A fresh element's box starts at 0,0 — carrying that into the union would
    // make every stroke intersect the whole document.
    const s = new StrokeElement('live4', [], false, STYLE);
    s.addPoint(5000, 5000, 0.5);
    s.addPoint(5010, 5010, 0.5);

    expect(s.intersectsWorldRect(new DOMRect(0, 0, 100, 100), 0)).toBe(false);
  });
});

describe('StrokeElement outline scale', () => {
  function outlineAtSize(size: number, hasPressure: boolean): number[] {
    const points = Array.from({ length: 100 }, (_, i) => [
      i * 0.08 * size,
      Math.sin(i / 8) * 0.8 * size,
      0.2 + (0.6 * i) / 99,
    ]).flat();
    const stroke = new StrokeElement('wave', points, hasPressure, {
      ...STYLE,
      size,
    });
    let outline: number[] = [];
    stroke.drawToPdf({
      worldToPagePt: (x, y) => ({ x: x / size, y: y / size }),
      ptPerWorldY: 1 / size,
      push: (item) => {
        if (item.t === 'path') {
          outline = item.pts;
        }
      },
      addImageBase64: () => 0,
      addFontBase64: () => 0,
    });
    return outline;
  }

  it.each([
    false,
    true,
  ])('preserves bends across pen sizes with real pressure %s', (hasPressure) => {
    const reference = outlineAtSize(16, hasPressure);
    expect(reference.length).toBeGreaterThan(0);
    for (const size of [1, 2, 8, 40]) {
      const outline = outlineAtSize(size, hasPressure);
      expect(outline).toHaveLength(reference.length);
      outline.forEach((coordinate, i) => {
        expect(coordinate).toBeCloseTo(reference[i], 8);
      });
    }
  });
});

describe('StrokeElement pressure-disabled taps', () => {
  const style: StrokeStyle = {
    ...STYLE,
    simulatePressure: false,
  };

  function finishedBounds(points: number[]): DOMRect {
    const stroke = new StrokeElement('tap', points, false, style);
    stroke.updateBounds();
    return stroke.localBoundingBox;
  }

  it.each([
    { name: 'one sample', points: [0, 0, 0] },
    { name: 'two samples', points: [0, 0, 0, 0.1, 0, 0] },
  ])('keeps a $name tap at the stroke width', ({ points }) => {
    const line = finishedBounds([0, 0, 0, 10, 0, 0, 20, 0, 0]);
    const tap = finishedBounds(points);

    expect(tap.height).toBeCloseTo(line.height, 1);
  });
});

describe('StrokeElement turning tip', () => {
  function outlineAtTip(
    stroke: StrokeElement,
    x: number,
    y: number,
  ): number[][] {
    const outline: number[][] = [];
    stroke.drawToPdf({
      worldToPagePt: (px, py) => ({ x: px - x, y: py - y }),
      ptPerWorldY: 1,
      push: (item) => {
        if (item.t === 'path') {
          for (let i = 0; i < item.pts.length; i += 2) {
            outline.push([item.pts[i], item.pts[i + 1]]);
          }
        }
      },
      addImageBase64: () => 0,
      addFontBase64: () => 0,
    });
    return outline;
  }

  function tipDisplacement(from: number[][], to: number[][]): number {
    let displacement = 0;
    for (const [x, y] of from) {
      if (Math.hypot(x, y) > STYLE.size * 1.25) {
        continue;
      }
      let nearest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < to.length; i++) {
        const a = to[i];
        const b = to[(i + 1) % to.length];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared
          ? Math.max(
              0,
              Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared),
            )
          : 0;
        nearest = Math.min(
          nearest,
          Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy),
        );
      }
      displacement = Math.max(displacement, nearest);
    }
    return displacement;
  }

  it('does not turn subpixel direction noise into a nib-width spur', () => {
    const style = { ...STYLE, stabilization: 0 };
    const reference = new StrokeElement('straight', [], true, style);
    const noisy = new StrokeElement('wobble', [], true, style);
    for (let i = 0; i <= 300; i++) {
      const x = i / 10;
      reference.addPoint(x, 0, 0.5);
      noisy.addPoint(
        i === 280 || i === 281 ? 27.9 : x,
        i === 280 ? 0.03 : i === 281 ? -0.03 : 0,
        0.5,
      );
    }
    const expected = outlineAtTip(reference, 30, 0);
    const actual = outlineAtTip(noisy, 30, 0);
    expect(tipDisplacement(actual, expected)).toBeLessThan(0.1);
    expect(tipDisplacement(expected, actual)).toBeLessThan(0.1);
  });

  it.each([
    false,
    true,
  ])('does not twitch through a slow U turn with sensor pressure %s', (hasPressure) => {
    const stroke = new StrokeElement('u-turn', [], hasPressure, STYLE);
    const step = 0.12;
    for (let i = 0; i < 150; i++) {
      stroke.addPoint(0, i * step, 0.5);
    }

    let previous: number[][] | undefined;
    let largestDisplacement = 0;
    for (let i = 0; i <= 260; i++) {
      const angle = Math.PI - (i * Math.PI) / 260;
      const x = 10 + 10 * Math.cos(angle);
      const y = 18 + 10 * Math.sin(angle);
      stroke.addPoint(x, y, 0.5);
      const outline = outlineAtTip(stroke, x, y);
      if (previous) {
        largestDisplacement = Math.max(
          largestDisplacement,
          tipDisplacement(outline, previous),
          tipDisplacement(previous, outline),
        );
      }
      previous = outline;
    }

    // With the pointer held fixed in the comparison, the contour must not jump farther than a sample.
    expect(largestDisplacement).toBeLessThanOrEqual(step);
  });
});
