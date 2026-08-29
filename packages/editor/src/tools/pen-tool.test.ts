import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type { DrawableElement } from '../elements/drawable-element';
import { ShapeElement } from '../elements/shape-element';
import { StrokeElement } from '../elements/stroke-element';
import { catalogs } from '../i18n/messages';
import { YDocManager } from '../ydoc-manager';
import { PenTool } from './pen-tool';

type Pt = [number, number];

/** Dense closed rectangle perimeter polyline. */
function rectStroke(
  x: number,
  y: number,
  w: number,
  h: number,
  per = 20,
): Pt[] {
  const corners: Pt[] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ];
  const out: Pt[] = [];
  for (let c = 0; c < corners.length - 1; c++) {
    const [ax, ay] = corners[c];
    const [bx, by] = corners[c + 1];
    for (let i = 0; i < per; i++) {
      const t = i / per;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  out.push([x, y]);
  return out;
}

function ellipseStroke(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n = 80,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

function lineStroke(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  n = 40,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
  return out;
}

function triangleStroke(per = 20): Pt[] {
  const corners: Pt[] = [
    [100, 0],
    [200, 180],
    [0, 180],
    [100, 0],
  ];
  const out: Pt[] = [];
  for (let c = 0; c < corners.length - 1; c++) {
    const [ax, ay] = corners[c];
    const [bx, by] = corners[c + 1];
    for (let i = 0; i < per; i++) {
      const t = i / per;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  out.push([100, 0]);
  return out;
}

function squiggleStroke(): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < 60; i++) {
    out.push([
      Math.sin(i * 0.7) * 50 + i,
      Math.cos(i * 1.3) * 40 + Math.sin(i * 0.3) * 20,
    ]);
  }
  return out;
}

/**
 * Binds every added element to a REAL Y.Map via a real YDocManager. Essential: PenTool.tryRecognize
 * bails when currentStroke.yMap === null, and StrokeElement.addPoint only mirrors into the Y.Array
 * when bound — a mock that skips binding would silently never snap.
 *
 * `bind: false` reproduces the unbound-stroke case for the yMap-null guard test.
 */
function makeCanvas(opts: { bind?: boolean; realTransact?: boolean } = {}) {
  const bind = opts.bind ?? true;
  const ydoc = new YDocManager();
  const created: DrawableElement[] = [];
  let n = 0;

  const removeElement = vi.fn((el: DrawableElement) => {
    if (el.yMap) {
      ydoc.removeElementMap(el.yMap);
    }
  });
  const transact = vi.fn((fn: () => void) => {
    if (opts.realTransact) {
      ydoc.transact(fn);
    } else {
      fn();
    }
  });

  const addElement = vi.fn(
    <T extends DrawableElement>(factory: (uuid: string) => T): T => {
      const el = factory(`test-uuid-${n++}`);
      if (bind) {
        const props = {
          offsetX: el.offset.x,
          offsetY: el.offset.y,
          scaleX: el.scale.x,
          scaleY: el.scale.y,
          ...el.getYMapProps(),
        };
        const yMap = ydoc.createElementMap(el.type, el.uuid, props);
        el.bindToYMap(yMap);
      }
      created.push(el);
      return el;
    },
  );

  const canvas = {
    addElement,
    removeElement,
    transact,
    // No page frames, so a finished stroke never anchors into one.
    getElementsByType: () => [],
  } as unknown as DrawableCanvas;

  return {
    canvas,
    ydoc,
    created,
    addElement,
    removeElement,
    transact,
  };
}

const PRESSURE_EVENT = { pressure: 0.5 } as PointerEvent;

function pos(x: number, y: number): Vector2 {
  return { x, y };
}

/** Feed a point stream through the tool one update() per point. */
function feed(
  tool: { update: (c: DrawableCanvas, e: PointerEvent, p: Vector2) => void },
  canvas: DrawableCanvas,
  pts: Pt[],
): void {
  for (const [x, y] of pts) {
    tool.update(canvas, PRESSURE_EVENT, pos(x, y));
  }
}

function makeTool(): PenTool {
  return new PenTool(() => catalogs.en);
}

describe('PenTool draw-and-hold recognition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() creates a live StrokeElement', () => {
    const { canvas, created, addElement } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    expect(addElement).toHaveBeenCalledTimes(1);
    expect(created[0]).toBeInstanceOf(StrokeElement);
  });

  it('update() appends a point per call', () => {
    const { canvas, created } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    const stroke = created[0] as StrokeElement;
    feed(tool, canvas, [
      [0, 0],
      [5, 5],
      [10, 10],
    ]);
    expect(stroke.xyPoints).toHaveLength(3);
  });

  it('adopts stylus pressure, but not the constant 0.5 a mouse reports', () => {
    const { canvas, created } = makeCanvas();
    const tool = makeTool();

    tool.start(canvas, {} as PointerEvent);
    const mouseStroke = created[0] as StrokeElement;
    feed(tool, canvas, [
      [0, 0],
      [5, 5],
    ]);
    expect(mouseStroke.pressureEnabled).toBe(false);
    tool.finish(canvas, {} as PointerEvent);

    tool.start(canvas, {} as PointerEvent);
    const penStroke = created[1] as StrokeElement;
    tool.update(canvas, { pressure: 0.5 } as PointerEvent, pos(0, 0));
    tool.update(canvas, { pressure: 0.74 } as PointerEvent, pos(5, 5));
    expect(penStroke.pressureEnabled).toBe(true);
  });

  it('snaps a clean rectangle to a rect ShapeElement after dwell', () => {
    const { canvas, created, removeElement } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    const stroke = created[0] as StrokeElement;

    feed(tool, canvas, rectStroke(10, 20, 200, 120));
    // Last update re-armed the timer; hold still.
    vi.advanceTimersByTime(600);

    expect(removeElement).toHaveBeenCalledWith(stroke);
    const shape = created[1] as ShapeElement;
    expect(shape).toBeInstanceOf(ShapeElement);
    expect(shape.shapeType).toBe('rect');
    // Offset is the world bbox-min; local geom shifted to [0,0,w,h].
    expect(shape.offset.x).toBeCloseTo(10, 0);
    expect(shape.offset.y).toBeCloseTo(20, 0);
    expect(shape.localBoundingBox.width).toBeCloseTo(200, 0);
    expect(shape.localBoundingBox.height).toBeCloseTo(120, 0);
  });

  it('one-way locks after snap: further update() adds no points', () => {
    const { canvas, created, addElement } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    const stroke = created[0] as StrokeElement;
    feed(tool, canvas, rectStroke(10, 20, 200, 120));
    vi.advanceTimersByTime(600);

    const callsAfterSnap = addElement.mock.calls.length;
    const ptsAfterSnap = stroke.xyPoints.length;
    // Move far away after snap — must be ignored.
    tool.update(canvas, PRESSURE_EVENT, pos(900, 900));
    expect(stroke.xyPoints).toHaveLength(ptsAfterSnap);
    expect(addElement.mock.calls.length).toBe(callsAfterSnap);
  });

  it('snaps an ellipse', () => {
    const { canvas, created } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    feed(tool, canvas, ellipseStroke(100, 100, 60, 40));
    vi.advanceTimersByTime(600);
    const shape = created[1] as ShapeElement;
    expect(shape).toBeInstanceOf(ShapeElement);
    expect(shape.shapeType).toBe('ellipse');
  });

  it('snaps a line and preserves endpoints via offset', () => {
    const { canvas, created } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    feed(tool, canvas, lineStroke(20, 30, 220, 80));
    vi.advanceTimersByTime(600);
    const shape = created[1] as ShapeElement;
    expect(shape.shapeType).toBe('line');
    // World endpoints reconstruct from offset + local geom.
    const bbox = shape.boundingBox;
    expect(bbox.x).toBeCloseTo(20, 0);
    expect(bbox.y).toBeCloseTo(30, 0);
    expect(bbox.width).toBeCloseTo(200, 0);
    expect(bbox.height).toBeCloseTo(50, 0);
  });

  it('snaps a triangle', () => {
    const { canvas, created } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    feed(tool, canvas, triangleStroke());
    vi.advanceTimersByTime(600);
    const shape = created[1] as ShapeElement;
    expect(shape.shapeType).toBe('triangle');
  });

  it('does not snap a random squiggle and keeps drawing', () => {
    const { canvas, created, removeElement } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    const stroke = created[0] as StrokeElement;
    feed(tool, canvas, squiggleStroke());
    vi.advanceTimersByTime(600);

    expect(removeElement).not.toHaveBeenCalled();
    expect(created).toHaveLength(1); // still just the stroke

    // Stroke keeps accepting points.
    const before = stroke.xyPoints.length;
    tool.update(canvas, PRESSURE_EVENT, pos(500, 500));
    expect(stroke.xyPoints.length).toBe(before + 1);

    tool.finish(canvas, {} as PointerEvent);
  });

  it('re-arms the dwell timer when the pen moves > DWELL_MOVE_PX', () => {
    const { canvas, created, removeElement } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    feed(tool, canvas, rectStroke(10, 20, 200, 120));

    // Wait 400ms (< 600) then move far: the pending timer is cleared and re-armed.
    vi.advanceTimersByTime(400);
    tool.update(canvas, PRESSURE_EVENT, pos(800, 800));
    vi.advanceTimersByTime(400); // only 400ms since the re-arm → no fire yet
    expect(removeElement).not.toHaveBeenCalled();

    // Complete the new dwell window.
    vi.advanceTimersByTime(200);
    // The 800,800 jump makes the stroke no longer a rectangle, so no snap, but
    // the timer DID fire (recognizeShape attempted). Assert no crash + still stroke.
    expect(created).toHaveLength(1);
  });

  it('fires recognition exactly once per anchor even with a late tiny move', () => {
    const { canvas, created, addElement } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    feed(tool, canvas, rectStroke(10, 20, 200, 120));

    // A sub-threshold move just before the timer fires does NOT clear it and does
    // NOT reset recognitionAttemptedForAnchor; the single armed timer fires once.
    vi.advanceTimersByTime(599);
    const rectPts = rectStroke(10, 20, 200, 120);
    const last = rectPts[rectPts.length - 1];
    tool.update(canvas, PRESSURE_EVENT, pos(last[0] + 3, last[1] + 3)); // < 12px
    vi.advanceTimersByTime(1); // original timer fires

    // Exactly one swap happened (stroke add + one shape add).
    const shapeAdds = (created as DrawableElement[]).filter(
      (e) => e instanceof ShapeElement,
    );
    expect(shapeAdds).toHaveLength(1);
    expect(addElement).toHaveBeenCalledTimes(2);

    // Run any further queued timers — no double-swap.
    vi.runAllTimers();
    expect(addElement).toHaveBeenCalledTimes(2);
  });

  it('does not fire a stale recognition when released before dwell', () => {
    const { canvas, created, removeElement } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    feed(tool, canvas, rectStroke(10, 20, 200, 120));

    vi.advanceTimersByTime(300); // before 600
    tool.finish(canvas, {} as PointerEvent); // interrupt → clearDwellTimer
    vi.runAllTimers();

    expect(removeElement).not.toHaveBeenCalled();
    expect(created).toHaveLength(1); // committed as a stroke
  });

  it('abort() discards the nascent stroke instead of committing it', () => {
    const { canvas, created, removeElement } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    const stroke = created[0] as StrokeElement;

    // The pen-hold that opens the tool wheel: a couple of points, then gone.
    feed(tool, canvas, [
      [0, 0],
      [2, 2],
    ]);
    tool.abort(canvas);

    expect(removeElement).toHaveBeenCalledWith(stroke);
    // Dwell timer went with it — no stale recognition once the wheel is up.
    vi.runAllTimers();
    expect(created).toHaveLength(1);
  });

  it('abort() removes the snapped shape when recognition already ran', () => {
    const { canvas, created, removeElement } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    feed(tool, canvas, rectStroke(10, 20, 200, 120));
    vi.advanceTimersByTime(600);

    const shape = created[1] as ShapeElement;
    expect(shape).toBeInstanceOf(ShapeElement);

    tool.abort(canvas);
    expect(removeElement).toHaveBeenCalledWith(shape);
  });

  it('no-ops when the stroke has no bound Y.Map (guard)', () => {
    const { canvas, created, removeElement } = makeCanvas({ bind: false });
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    const stroke = created[0] as StrokeElement;
    expect(stroke.yMap).toBeNull();

    // Feed enough geometry to be recognizable, then dwell.
    feed(tool, canvas, rectStroke(10, 20, 200, 120));
    vi.advanceTimersByTime(600);

    expect(removeElement).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
  });

  it('silently rejects a sub-MIN_POINTS hold without crashing', () => {
    const { canvas, created, removeElement } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    const stroke = created[0] as StrokeElement;

    // Only 5 points, barely moving (< 12px apart) so no re-arm churn.
    feed(tool, canvas, [
      [0, 0],
      [2, 1],
      [4, 2],
      [6, 1],
      [8, 0],
    ]);
    vi.advanceTimersByTime(600);

    expect(removeElement).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    // Stroke still alive and growing.
    const before = stroke.xyPoints.length;
    tool.update(canvas, PRESSURE_EVENT, pos(100, 100));
    expect(stroke.xyPoints.length).toBe(before + 1);
  });

  // REAL timers: Yjs UndoManager.captureTimeout (500ms) runs on a wall clock vitest fake timers do
  // not advance, so the DWELL(600) > captureTimeout(500) separation only shows with real elapsed time.
  it('undo restores the stroke after a snap (atomic group)', async () => {
    vi.useRealTimers();
    const { canvas, ydoc, created } = makeCanvas({ realTransact: true });
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);

    feed(tool, canvas, rectStroke(10, 20, 200, 120));
    await new Promise((r) => setTimeout(r, 650)); // dwell fires → snap

    const shape = created[1] as ShapeElement;
    expect(shape).toBeInstanceOf(ShapeElement);
    // After snap the doc holds the shape's Y.Map (stroke removed in same transact).
    expect(ydoc.elements.length).toBe(1);
    expect(ydoc.elements.get(0).get('type')).toBe(shape.type);

    ydoc.undoManager.undo();
    // The remove+add was one atomic, local-origin transaction captured as its own undo group, so one
    // undo step brings the stroke's Y.Map back rather than wiping both.
    expect(ydoc.elements.length).toBe(1);
    expect(ydoc.elements.get(0).get('type')).toBe(created[0].type);
  });
});
