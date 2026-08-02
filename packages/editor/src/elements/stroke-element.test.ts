import { afterEach, describe, expect, it, vi } from 'vitest';
import { YDocManager } from '../ydoc-manager';
import { ElementType } from './element-type';
import {
  StrokeElement,
  type StrokeStyle,
  strokeOutlineToPath,
} from './stroke-element';

const STYLE: StrokeStyle = { color: '#191c1e', size: 8 };
const CTX = {} as CanvasRenderingContext2D;

type PathCall = [string, ...number[]];

/** Records the curve commands issued, in place of a real Path2D. */
function stubPath2D(): PathCall[] {
  const calls: PathCall[] = [];
  class RecordingPath2D {
    moveTo(x: number, y: number) {
      calls.push(['moveTo', x, y]);
    }
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      calls.push(['quadraticCurveTo', cx, cy, x, y]);
    }
    closePath() {
      calls.push(['closePath']);
    }
  }
  vi.stubGlobal('Path2D', RecordingPath2D);
  return calls;
}

describe('strokeOutlineToPath', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('emits the curves the SVG path string it replaced described', () => {
    // The old code formatted "M0,0 Q10,0 10,5 T5,10 0,5 Z" and had the browser
    // parse it back. Each T is a smooth quadratic: its control point is the
    // previous control reflected about the current point, expanded here by
    // hand. Same geometry, without building and reparsing a string per frame.
    const calls = stubPath2D();
    strokeOutlineToPath([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);

    expect(calls).toEqual([
      ['moveTo', 0, 0],
      ['quadraticCurveTo', 10, 0, 10, 5],
      ['quadraticCurveTo', 10, 10, 5, 10],
      ['quadraticCurveTo', 0, 10, 0, 5],
      ['closePath'],
    ]);
  });

  it('draws nothing for an outline too short to curve', () => {
    // Matches the old `len < 4` guard, which returned an empty `d` string.
    const calls = stubPath2D();
    strokeOutlineToPath([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);

    expect(calls).toEqual([]);
  });
});

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

  it('drops cached geometry when a remote edit replaces the points', () => {
    // The perfect-freehand input tuples are reused across frames rather than
    // rebuilt, so a wholesale replacement (a remote sync, an undo) has to clear
    // them. Otherwise the stale prefix survives and the stroke keeps drawing
    // and hit-testing where it used to be.
    const s = new StrokeElement('s4', [], false, STYLE);
    s.addPoint(0, 0, 0.5);
    s.addPoint(100, 0, 0.5);
    s.addPoint(100, 50, 0.5);

    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.STROKE, 's4', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      ...s.getYMapProps(),
    });
    s.bindToYMap(yMap);
    // Populates the tuple cache from the original points.
    s.updateBounds();
    expect(s.localBoundingBox.width).toBeGreaterThan(50);

    // How a remote update reaches an element: the canvas observes the doc and
    // hands the changed keys down.
    yMap.set('points', [0, 0, 0.5, 1, 0, 0.5, 1, 1, 0.5]);
    s.syncFromYMap(['points']);

    expect(s.xyPoints).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    // Bounds follow the new points; a surviving cache would keep the old span.
    expect(s.localBoundingBox.width).toBeLessThan(50);
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
