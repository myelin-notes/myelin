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
const POINT_FLUSH_INTERVAL_MS = 300;

export class StrokeElement extends DrawableElement {
  protected box: DOMRect;
  protected dirty: boolean = true;
  protected cachedPath: Path2D;

  /** Wall-clock of the last Yjs flush, for throttling live writes. */
  private lastFlush: number = 0;

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

  /** Materialize the flat buffer as perfect-freehand input tuples (transient). */
  private toTuples(): [number, number, number][] {
    const pts = this.points;
    const n = (pts.length / 3) | 0;
    const out = new Array<[number, number, number]>(n);
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      out[i] = [pts[j], pts[j + 1], pts[j + 2]];
    }
    return out;
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
      this.cachedPath = new Path2D(this.getSvgPathFromStroke(outline));
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

  protected average(a: number, b: number) {
    return (a + b) / 2;
  }

  private getSvgPathFromStroke(points: number[][], closed = true) {
    const len = points.length;

    if (len < 4) {
      return ``;
    }

    let a = points[0];
    let b = points[1];
    const c = points[2];

    let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(
      2,
    )},${b[1].toFixed(2)} ${this.average(b[0], c[0]).toFixed(2)},${this.average(
      b[1],
      c[1],
    ).toFixed(2)} T`;

    for (let i = 2, max = len - 1; i < max; i++) {
      a = points[i];
      b = points[i + 1];
      result += `${this.average(a[0], b[0]).toFixed(2)},${this.average(
        a[1],
        b[1],
      ).toFixed(2)} `;
    }

    if (closed) {
      result += 'Z';
    }

    return result;
  }
}
