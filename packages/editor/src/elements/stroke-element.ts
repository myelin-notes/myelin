import {
  getStroke,
  getStrokeOutlinePoints,
  getStrokePoints,
} from 'perfect-freehand';
import type * as Y from 'yjs';
import { parseCssColor } from '../pdf-export/color';
import type { PdfHarvestContext } from '../pdf-export/harvest';
import { CollisionHelper } from '../utils/collision-helper';
import { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';

export interface StrokeStyle {
  color: string;
  size: number;
}

/**
 * While a stroke is being drawn its points are buffered in memory and pushed to
 * Yjs no more than this often. One write within the UndoManager's capture
 * window keeps the whole stroke (creation → points) in a single undo step
 * without paying a transaction per pointer sample.
 */
export const POINT_FLUSH_INTERVAL_MS = 300;

export class StrokeElement extends DrawableElement {
  protected box: DOMRect;
  protected dirty: boolean = true;
  protected cachedPath: Path2D;

  /** Wall-clock of the last Yjs flush, for throttling live writes. */
  private lastFlush: number = 0;

  /** Reused perfect-freehand input, kept in step with `points`. @see toTuples */
  private tuples: [number, number, number][] = [];

  public get strokeStyle(): StrokeStyle {
    return this.style;
  }

  /** World-space [x, y] coordinates of the recorded stroke points. */
  public get xyPoints(): [number, number][] {
    const pts = this.points;
    const n = (pts.length / 3) | 0;
    const out = new Array<[number, number]>(n);
    for (let i = 0; i < n; i++) {
      out[i] = [pts[i * 3], pts[i * 3 + 1]];
    }
    return out;
  }

  public get pressureEnabled(): boolean {
    return this.hasPressure;
  }

  public override getYMapProps(): Record<string, unknown> {
    return {
      color: this.style.color,
      size: this.style.size,
      hasPressure: this.hasPressure,
      // Flat [x,y,p, ...] stored as a single Y.Map value rather than a
      // Y.Array<number>: one CRDT item instead of one per coordinate.
      points: [...this.points],
    };
  }

  public constructor(
    uuid: string,
    /** Flat point buffer: [x, y, pressure, x, y, pressure, ...]. */
    protected points: number[],
    protected hasPressure: boolean,
    protected style: StrokeStyle,
  ) {
    super(uuid, ElementType.STROKE);
    this.box = new DOMRect(0, 0, 0, 0);
    this.cachedPath = new Path2D();
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      color: (v) => {
        this.style.color = v as string;
      },
      size: (v) => {
        this.style.size = v as number;
        this.dirty = true;
      },
      hasPressure: (v) => {
        this.hasPressure = v as boolean;
        this.dirty = true;
      },
      points: (v) => {
        this.points = (v as number[]).slice();
        // Wholesale replacement, not an append: the cached tuples describe the
        // previous buffer and cannot be reused for any index.
        this.tuples.length = 0;
        this.dirty = true;
        this.updateBounds();
      },
    });
  }

  public addPoint(x: number, y: number, pressure: number | undefined) {
    this.points.push(x, y, pressure ?? 0);
    this.dirty = true;

    // Throttled live flush so a long stroke stays in one undo group; the final
    // state is always persisted by commit() on pointer-up.
    const now = Date.now();
    if (now - this.lastFlush >= POINT_FLUSH_INTERVAL_MS) {
      this.lastFlush = now;
      this.flushPoints();
    }
  }

  /** Persist the full point buffer to Yjs. Called when the stroke is finished. */
  public commit(): void {
    this.flushPoints();
  }

  private flushPoints(): void {
    if (this.yMap) {
      this.syncToYMap({ points: [...this.points] });
    }
  }

  /**
   * The flat buffer as perfect-freehand input tuples.
   *
   * Grown in step with `points` rather than rebuilt, because this runs on every
   * frame of a live stroke: allocating one array per point per frame, over a
   * point list that grows as you draw, was enough garbage to show up in the
   * frame gap on a low-end tablet.
   *
   * The returned array is shared and reused — callers must not retain or mutate
   * it. Anything that *replaces* `points` instead of appending to it has to
   * clear this (see the `points` field binding), or the stale prefix survives.
   */
  private toTuples(): [number, number, number][] {
    const pts = this.points;
    const n = (pts.length / 3) | 0;
    if (this.tuples.length > n) {
      this.tuples.length = n;
    }
    for (let i = this.tuples.length; i < n; i++) {
      const j = i * 3;
      this.tuples.push([pts[j], pts[j + 1], pts[j + 2]]);
    }
    return this.tuples;
  }

  public draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
    if (this.points.length < 3) {
      return;
    }
    if (this.dirty) {
      // The outline is only needed to build the Path2D; it is not retained.
      const outline = getStroke(this.toTuples(), {
        simulatePressure: !this.hasPressure,
        size: this.style.size,
      });
      this.cachedPath = strokeOutlineToPath(outline);
      this.dirty = false;
    }

    ctx.fillStyle = this.style.color;
    ctx.fill(this.cachedPath);
  }

  public override drawToPdf(ctx: PdfHarvestContext): void {
    if (this.points.length < 3) {
      return;
    }
    // Same outline perfect-freehand produces on screen, as a filled vector path.
    const outline = getStroke(this.toTuples(), {
      simulatePressure: !this.hasPressure,
      size: this.style.size,
    });
    if (outline.length < 3) {
      return;
    }
    const pts: number[] = [];
    for (const [x, y] of outline) {
      const p = ctx.worldToPagePt(x, y);
      pts.push(p.x, p.y);
    }
    const { rgb, opacity } = parseCssColor(this.style.color);
    ctx.push({ t: 'path', pts, closed: true, fill: rgb, opacity });
  }

  protected isOverLocal(
    x: number,
    y: number,
    radius: number,
    _ctx: CanvasRenderingContext2D,
  ): boolean {
    // Hit-test the raw centerline inflated by the stroke half-width, instead of
    // the perfect-freehand outline. Avoids storing (or recomputing) the outline
    // and is what the eraser walks every pointer move.
    const pts = this.points;
    if (pts.length < 2) {
      return false;
    }
    const tol = radius + this.style.size / 2;
    const circle = { x, y };
    const a = { x: pts[0], y: pts[1] };
    if (CollisionHelper.inCircle(a, circle, tol)) {
      return true;
    }
    const b = { x: 0, y: 0 };
    for (let i = 3; i + 1 < pts.length; i += 3) {
      b.x = pts[i];
      b.y = pts[i + 1];
      if (CollisionHelper.inCircle(b, circle, tol)) {
        return true;
      }
      if (CollisionHelper.doesSegmentIntersectCircle(a, b, circle, tol)) {
        return true;
      }
      a.x = b.x;
      a.y = b.y;
    }
    return false;
  }

  public get localBoundingBox(): DOMRect {
    return this.box;
  }

  protected updateBoundingBox() {
    if (this.points.length < 3) {
      return;
    }

    const outlinePoints = getStrokeOutlinePoints(
      getStrokePoints(this.toTuples()),
    );

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const [x, y] of outlinePoints) {
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }

    this.box = new DOMRect(minX, minY, maxX - minX, maxY - minY);
  }
}

/**
 * The perfect-freehand outline as a closed, fillable path.
 *
 * Same geometry as the `getSvgPathFromStroke` snippet in perfect-freehand's
 * docs, but written straight into a Path2D instead of formatted as an SVG `d`
 * string for the browser to parse back. The string form cost four `toFixed`
 * calls and a concatenation per outline point — on every frame of a live
 * stroke, over an outline that grows as you draw — to produce a path the
 * canvas can build directly.
 *
 * The `T` (smooth quadratic) commands are expanded by hand: each control point
 * is the previous control point reflected about the current point.
 */
export function strokeOutlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  const len = outline.length;
  if (len < 4) {
    return path;
  }

  const start = outline[0];
  const first = outline[1];
  const second = outline[2];

  path.moveTo(start[0], start[1]);
  // The one explicit quadratic; its control point seeds the reflection chain.
  let ctrlX = first[0];
  let ctrlY = first[1];
  let curX = (first[0] + second[0]) / 2;
  let curY = (first[1] + second[1]) / 2;
  path.quadraticCurveTo(ctrlX, ctrlY, curX, curY);

  for (let i = 2, max = len - 1; i < max; i++) {
    const a = outline[i];
    const b = outline[i + 1];
    const reflectedX = 2 * curX - ctrlX;
    const reflectedY = 2 * curY - ctrlY;
    const nextX = (a[0] + b[0]) / 2;
    const nextY = (a[1] + b[1]) / 2;
    path.quadraticCurveTo(reflectedX, reflectedY, nextX, nextY);
    ctrlX = reflectedX;
    ctrlY = reflectedY;
    curX = nextX;
    curY = nextY;
  }

  path.closePath();
  return path;
}
