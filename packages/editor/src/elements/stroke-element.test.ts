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
