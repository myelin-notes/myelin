import { getStrokeOutlinePoints, getStrokePoints } from 'perfect-freehand';
import type * as Y from 'yjs';
import { resolveInkColor } from '../canvas-theme';
import { parseCssColor } from '../pdf-export/color';
import type { PdfHarvestContext } from '../pdf-export/harvest';
import { CollisionHelper } from '../utils/collision-helper';
import { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';

export interface StrokeStyle {
  color: string;
  size: number;
  /** perfect-freehand `streamline`, 0 = raw input. Absent on strokes saved before it existed. */
  stabilization?: number;
  /** False for pressure-disabled, uniform-width strokes; absent enables sensor or velocity pressure. */
  simulatePressure?: boolean;
}

export const DEFAULT_STABILIZATION = 0.5;

// perfect-freehand uses fixed 3-unit end filtering and a 1-unit dot offset. Normalize to its
// default size so those thresholds don't swallow bends or inflate caps on thin strokes.
const OUTLINE_SIZE = 16;

// One write within the UndoManager's capture window keeps the whole stroke (creation → points)
// in a single undo step without paying a transaction per pointer sample.
const POINT_FLUSH_INTERVAL_MS = 300;

// Pointer Events reports a flat 0.5 for the whole drag on hardware with no pressure sensor, so a
// differing sample is the only proof a real sensor is behind the stroke. Until one arrives the
// stroke keeps perfect-freehand's velocity simulation, which is what a mouse wants.
const NO_SENSOR_PRESSURE = 0.5;

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

  /** Surviving contiguous point buffers, or `null` when the eraser touches no sampled point. */
  public getPointRunsOutsideCircle(
    x: number,
    y: number,
    radius: number,
  ): number[][] | null {
    const localX = (x - this.offset.x) / this.scale.x;
    const localY = (y - this.offset.y) / this.scale.y;
    const localRadius =
      radius / Math.min(Math.abs(this.scale.x), Math.abs(this.scale.y));
    const tolerance = localRadius + this.style.size / 2;
    const toleranceSquared = tolerance * tolerance;
    const runs: number[][] = [];
    let currentRun: number[] | null = null;
    let erased = false;

    for (let i = 0; i + 2 < this.points.length; i += 3) {
      const dx = this.points[i] - localX;
      const dy = this.points[i + 1] - localY;
      if (dx * dx + dy * dy <= toleranceSquared) {
        erased = true;
        currentRun = null;
        continue;
      }
      if (!currentRun) {
        currentRun = [];
        runs.push(currentRun);
      }
      currentRun.push(this.points[i], this.points[i + 1], this.points[i + 2]);
    }

    return erased ? runs : null;
  }

  /** Replace the recorded samples and persist the new buffer. */
  public replacePoints(points: number[]): void {
    this.points = points.slice();
    this.dirty = true;
    this.updateBounds();
    this.flushPoints();
  }

  public override getYMapProps(): Record<string, unknown> {
    return {
      color: this.style.color,
      size: this.style.size,
      stabilization: this.style.stabilization ?? DEFAULT_STABILIZATION,
      ...(this.style.simulatePressure === undefined
        ? {}
        : { simulatePressure: this.style.simulatePressure }),
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
      stabilization: (v) => {
        this.style.stabilization = v as number;
        this.dirty = true;
      },
      simulatePressure: (v) => {
        this.style.simulatePressure = v as boolean;
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
    const isFirst = this.points.length === 0;
    this.points.push(x, y, pressure ?? 0);
    this.dirty = true;
    this.growBoundsTo(x, y, isFirst);

    // Every sample already carries its real value, so flipping mid-stroke
    // re-renders the whole stroke from recorded pressure, not just the rest.
    if (
      !this.hasPressure &&
      pressure !== undefined &&
      pressure > 0 &&
      pressure !== NO_SENSOR_PRESSURE
    ) {
      this.hasPressure = true;
    }

    // Throttled live flush so a long stroke stays in one undo group; the final
    // state is always persisted by commit() on pointer-up.
    const now = Date.now();
    if (now - this.lastFlush >= POINT_FLUSH_INTERVAL_MS) {
      this.lastFlush = now;
      this.flushPoints();
    }
  }

  // `updateBoundingBox` only runs when the stroke is finished, so without this a live stroke would
  // carry the empty box it was constructed with — and the renderer culls by that box, leaving the
  // ink invisible until the pen lifted. Padding by the full `size` bounds perfect-freehand's radius
  // (at most 0.75 * size), so the box is never too small.
  private growBoundsTo(x: number, y: number, isFirst: boolean): void {
    const pad = this.style.size;
    if (isFirst) {
      this.box = new DOMRect(x - pad, y - pad, pad * 2, pad * 2);
      return;
    }
    const minX = Math.min(this.box.x, x - pad);
    const minY = Math.min(this.box.y, y - pad);
    const maxX = Math.max(this.box.x + this.box.width, x + pad);
    const maxY = Math.max(this.box.y + this.box.height, y + pad);
    this.box = new DOMRect(minX, minY, maxX - minX, maxY - minY);
  }

  /** Persist the full point buffer to Yjs. Called when the stroke is finished. */
  public commit(): void {
    this.flushPoints();
  }

  private flushPoints(): void {
    if (this.yMap) {
      // hasPressure rides along: it is serialized as false when the element is
      // created and only settles once a sample proves the device has a sensor.
      this.syncToYMap({
        hasPressure: this.hasPressure,
        points: [...this.points],
      });
    }
  }

  private strokeOutline(): number[][] {
    if (this.points.length < 3 || this.style.size <= 0) {
      return [];
    }

    const scale = OUTLINE_SIZE / this.style.size;
    const pts = this.points;
    const originX = pts[0];
    const originY = pts[1];
    const n = (pts.length / 3) | 0;
    const input = new Array<[number, number, number]>(n);
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      input[i] = [
        (pts[j] - originX) * scale,
        (pts[j + 1] - originY) * scale,
        pts[j + 2],
      ];
    }

    // perfect-freehand adds synthetic motion for 1–2 inputs and drops pressure in its two-point
    // expansion. Three explicit samples keep tap caps at the stroke's recorded width.
    if (input.length === 1) {
      input.push([...input[0]], [...input[0]]);
    } else if (input.length === 2) {
      const [a, b] = input;
      input.splice(1, 0, [
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
        (a[2] + b[2]) / 2,
      ]);
    }

    const options = {
      simulatePressure: this.style.simulatePressure ?? !this.hasPressure,
      size: OUTLINE_SIZE,
      ...(this.style.simulatePressure === false ? { thinning: 0 } : {}),
      // The default edge spacing makes the live cap jump when a new point survives a turn.
      smoothing: 0.1,
      streamline: this.style.stabilization ?? DEFAULT_STABILIZATION,
      last: true,
    };
    const strokePoints = getStrokePoints(input, options);
    if (strokePoints.length > 1) {
      // Opposing vectors cancel at a hairpin; averaging their unwrapped angles keeps the turn
      // continuous while still filtering reversals too short to rotate a full-width edge.
      const angles = new Array<number>(strokePoints.length);
      const angleIntegrals = new Array<number>(strokePoints.length).fill(0);
      angles[0] = Math.atan2(
        strokePoints[0].vector[1],
        strokePoints[0].vector[0],
      );
      for (let i = 1; i < strokePoints.length; i++) {
        const rawAngle = Math.atan2(
          strokePoints[i].vector[1],
          strokePoints[i].vector[0],
        );
        const delta = Math.atan2(
          Math.sin(rawAngle - angles[i - 1]),
          Math.cos(rawAngle - angles[i - 1]),
        );
        angles[i] = angles[i - 1] + delta;
        angleIntegrals[i] =
          angleIntegrals[i - 1] +
          angles[i] *
            (strokePoints[i].runningLength - strokePoints[i - 1].runningLength);
      }

      let lowerSegment = 1;
      let upperSegment = 1;
      const tangentDistance = OUTLINE_SIZE / 2;
      const totalLength = strokePoints[strokePoints.length - 1].runningLength;
      for (const point of strokePoints) {
        const lowerLength = Math.max(
          strokePoints[0].runningLength,
          point.runningLength - tangentDistance,
        );
        const upperLength = Math.min(
          totalLength,
          point.runningLength + tangentDistance,
        );
        while (
          lowerSegment < strokePoints.length - 1 &&
          strokePoints[lowerSegment].runningLength < lowerLength
        ) {
          lowerSegment++;
        }
        while (
          upperSegment < strokePoints.length - 1 &&
          strokePoints[upperSegment].runningLength < upperLength
        ) {
          upperSegment++;
        }
        const lowerIntegral =
          angleIntegrals[lowerSegment - 1] +
          angles[lowerSegment] *
            (lowerLength - strokePoints[lowerSegment - 1].runningLength);
        const upperIntegral =
          angleIntegrals[upperSegment - 1] +
          angles[upperSegment] *
            (upperLength - strokePoints[upperSegment - 1].runningLength);
        const angle =
          (upperIntegral - lowerIntegral) / (upperLength - lowerLength);
        point.vector = [Math.cos(angle), Math.sin(angle)];
      }
    }
    const outline = getStrokeOutlinePoints(strokePoints, options);
    for (const point of outline) {
      point[0] = point[0] / scale + originX;
      point[1] = point[1] / scale + originY;
    }
    return outline;
  }

  public draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
    if (this.points.length < 3) {
      return;
    }
    if (this.dirty) {
      // The outline is only needed to build the Path2D; it is not retained.
      const outline = this.strokeOutline();
      const path = new Path2D();
      appendStrokeOutline(path, outline);
      this.cachedPath = path;
      this.dirty = false;
    }

    ctx.fillStyle = resolveInkColor(this.style.color);
    ctx.fill(this.cachedPath);
  }

  public override drawToPdf(ctx: PdfHarvestContext): void {
    if (this.points.length < 3) {
      return;
    }
    // Same outline perfect-freehand produces on screen, as a filled vector path.
    const outline = this.strokeOutline();
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
    // Hit-test the raw centerline inflated by the half-width, not the perfect-freehand outline:
    // avoids storing or recomputing the outline, and the eraser walks this every pointer move.
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

    const outlinePoints = this.strokeOutline();

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

/** The subset of `Path2D` {@link appendStrokeOutline} drives. */
export interface QuadraticPathSink {
  moveTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  closePath(): void;
}

/**
 * Trace a perfect-freehand outline onto `path`: a quadratic through the first three points, then
 * one smooth quadratic per remaining point, each ending at the midpoint of a point and its successor.
 *
 * Formerly an SVG path string handed to `Path2D`. That string is rebuilt every frame an in-progress
 * stroke grows, and its two `toFixed(2)` calls per outline point were ~72% of the rebuild — more
 * than perfect-freehand's own geometry pass — before the parse it then paid for.
 *
 * Each curve after the first was an SVG `T`, which reflects the previous control point.
 * `quadraticCurveTo` has no shorthand, so the reflection is computed here to keep the shape identical.
 */
export function appendStrokeOutline(
  path: QuadraticPathSink,
  outline: number[][],
): void {
  if (outline.length < 4) {
    return;
  }

  path.moveTo(outline[0][0], outline[0][1]);

  let ctrlX = outline[1][0];
  let ctrlY = outline[1][1];
  let curX = (outline[1][0] + outline[2][0]) / 2;
  let curY = (outline[1][1] + outline[2][1]) / 2;
  path.quadraticCurveTo(ctrlX, ctrlY, curX, curY);

  for (let i = 2, max = outline.length - 1; i < max; i++) {
    const endX = (outline[i][0] + outline[i + 1][0]) / 2;
    const endY = (outline[i][1] + outline[i + 1][1]) / 2;
    const reflectedX = 2 * curX - ctrlX;
    const reflectedY = 2 * curY - ctrlY;
    path.quadraticCurveTo(reflectedX, reflectedY, endX, endY);
    ctrlX = reflectedX;
    ctrlY = reflectedY;
    curX = endX;
    curY = endY;
  }

  path.closePath();
}
