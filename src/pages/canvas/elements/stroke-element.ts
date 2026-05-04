import {
  getStroke,
  getStrokeOutlinePoints,
  getStrokePoints,
} from 'perfect-freehand';
import * as Y from 'yjs';
import { CollisionHelper } from '../../../lib/utils/collision-helper';
import { LOCAL_ORIGIN } from '../ydoc-manager';
import { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';

export interface StrokeStyle {
  color: string;
  size: number;
}

export class StrokeElement extends DrawableElement {
  protected box: DOMRect;
  protected dirty: boolean = true;
  protected cachedPath: Path2D;
  protected cachedPoints: number[][];

  /** Yjs backing array for points (flat: [x,y,p, x,y,p, ...]). */
  private _yPoints: Y.Array<number> | null = null;
  private readonly _handleYPointsChange = (
    event: Y.YArrayEvent<number>,
  ): void => {
    if (event.transaction.origin === LOCAL_ORIGIN) {
      return;
    }
    this.rebuildPointsFromYArray();
  };

  public get strokeStyle(): StrokeStyle {
    return this.style;
  }

  public get pressureEnabled(): boolean {
    return this.hasPressure;
  }

  public override getYMapProps(): Record<string, unknown> {
    return {
      color: this.style.color,
      size: this.style.size,
      hasPressure: this.hasPressure,
      points: new Y.Array<number>(),
    };
  }

  public constructor(
    index: number,
    protected points: [number, number, number][],
    protected hasPressure: boolean,
    protected style: StrokeStyle,
  ) {
    super(index, ElementType.STROKE);
    this.box = new DOMRect(0, 0, 0, 0);
    this.cachedPath = new Path2D();
    this.cachedPoints = [];
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      color: (v) => {
        this.style.color = v as string;
      },
      size: (v) => {
        this.style.size = v as number;
      },
      hasPressure: (v) => {
        this.hasPressure = v as boolean;
      },
    });

    const yPoints = yMap.get('points') as Y.Array<number> | undefined;
    if (yPoints) {
      this._yPoints?.unobserve(this._handleYPointsChange);
      this._yPoints = yPoints;
      this.rebuildPointsFromYArray();
      this.updateBounds();
      yPoints.observe(this._handleYPointsChange);
    }
  }

  public override disposeDOM(): void {
    this._yPoints?.unobserve(this._handleYPointsChange);
    this._yPoints = null;
    super.disposeDOM();
  }

  private rebuildPointsFromYArray(): void {
    if (!this._yPoints) {
      return;
    }
    const flat = this._yPoints.toArray();
    const len = Math.floor(flat.length / 3);
    this.points = new Array(len);
    for (let i = 0; i < len; i++) {
      this.points[i] = [flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]];
    }
    this.dirty = true;
  }

  public addPoint(x: number, y: number, pressure: number | undefined) {
    const p = pressure ?? 0;
    this.points = [...this.points, [x, y, p]];
    this.dirty = true;
    if (this._yPoints) {
      this._yPoints.doc!.transact(() => {
        this._yPoints!.push([x, y, p]);
      }, LOCAL_ORIGIN);
    }
  }

  public draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
    if (this.points.length === 0) {
      return;
    }
    if (this.dirty) {
      this.cachedPoints = getStroke(this.points, {
        simulatePressure: !this.hasPressure,
        size: this.style.size,
      });
      this.cachedPath = new Path2D(
        this.getSvgPathFromStroke(this.cachedPoints),
      );
    }

    ctx.fillStyle = this.style.color;
    ctx.fill(this.cachedPath);
  }

  protected isOverLocal(
    x: number,
    y: number,
    radius: number,
    _ctx: CanvasRenderingContext2D,
  ): boolean {
    return CollisionHelper.isPathOverlappingCircle(
      this.cachedPoints,
      { x, y },
      radius,
    );
  }

  public get localBoundingBox(): DOMRect {
    return this.box;
  }

  protected updateBoundingBox() {
    if (this.points.length === 0) {
      return;
    }

    const outlinePoints = getStrokeOutlinePoints(getStrokePoints(this.points));

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
