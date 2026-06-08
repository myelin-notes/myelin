import { describe, expect, it } from 'vitest';
import { YDocManager } from '../ydoc-manager';
import { ElementType } from './element-type';
import { StrokeElement, type StrokeStyle } from './stroke-element';

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
