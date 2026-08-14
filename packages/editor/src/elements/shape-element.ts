import type * as Y from 'yjs';
import { resolveInkColor } from '../canvas-theme';
import type { Vector2 } from '../geometry';
import { parseCssColor } from '../pdf-export/color';
import type { PdfHarvestContext } from '../pdf-export/harvest';
import type { ShapeType } from '../shape-recognizer';
import {
  DrawableElement,
  MIN_SCALE,
  type ResizeHandle,
  ResizeHandles,
} from './drawable-element';
import { ElementType } from './element-type';
import type { StrokeStyle } from './stroke-element';

/** Number of segments used to approximate an ellipse outline in PDF export. */
const ELLIPSE_PDF_SEGMENTS = 32;
/** Skip PDF output when the world-space bbox is smaller than this (avoids degenerate paths). */
const MIN_PDF_WORLD_SIZE = 1;

/**
 * Parametric vector shape (rect / ellipse / line / triangle) produced by the
 * draw-and-hold recognizer. Geometry is stored once in a normalized local frame
 * so world placement, resize, translate and undo are inherited from the base
 * class transform machinery.
 */
export class ShapeElement extends DrawableElement {
  protected box: DOMRect = new DOMRect(0, 0, 0, 0);

  /** Pre-drag geometry snapshot; resize ratios are cumulative from drag start. */
  private resizeBaseGeom: number[] | null = null;

  public constructor(
    uuid: string,
    public shapeType: ShapeType,
    protected geom: number[],
    protected style: StrokeStyle,
  ) {
    super(uuid, ElementType.SHAPE);
    this.updateBoundingBox();
  }

  public override getYMapProps(): Record<string, unknown> {
    return {
      shapeType: this.shapeType,
      color: this.style.color,
      size: this.style.size,
      // Flat geometry stored directly as one Y.Map value; the shape's geometry
      // is fully known at construction, so there is nothing to seed later.
      geom: [...this.geom],
    };
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      shapeType: (v) => {
        this.shapeType = v as ShapeType;
        this.updateBounds();
      },
      color: (v) => {
        this.style.color = v as string;
      },
      size: (v) => {
        this.style.size = v as number;
      },
      geom: (v) => {
        this.geom = (v as number[]).slice();
        this.updateBounds();
      },
    });
  }

  public get localBoundingBox(): DOMRect {
    return this.box;
  }

  /**
   * Grow a bbox axis thinner than the drawn stroke out to the stroke's width. A
   * snapped horizontal line has an exactly-zero-height geometry bbox, which no
   * box test can ever hit: click selection (`inBox`) uses strict inequalities,
   * marquee needs a non-zero area, and resize bails on an empty local box.
   */
  private withStrokeThickness(box: DOMRect): DOMRect {
    const w = Math.max(box.width, this.style.size);
    const h = Math.max(box.height, this.style.size);
    return new DOMRect(
      box.x - (w - box.width) / 2,
      box.y - (h - box.height) / 2,
      w,
      h,
    );
  }

  protected updateBoundingBox(): void {
    const g = this.geom;
    if (this.shapeType === 'rect' || this.shapeType === 'ellipse') {
      if (g.length < 4) {
        this.box = new DOMRect(0, 0, 0, 0);
        return;
      }
      this.box = this.withStrokeThickness(new DOMRect(g[0], g[1], g[2], g[3]));
      return;
    }
    // line / triangle: min/max of flat coordinate pairs.
    if (g.length < 4) {
      this.box = new DOMRect(0, 0, 0, 0);
      return;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i + 1 < g.length; i += 2) {
      const x = g[i];
      const y = g[i + 1];
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
    this.box = this.withStrokeThickness(
      new DOMRect(minX, minY, maxX - minX, maxY - minY),
    );
  }

  public override get resizeHandles(): ResizeHandles {
    return this.shapeType === 'line'
      ? ResizeHandles.Corners
      : ResizeHandles.All;
  }

  public override beginResize(): void {
    // applyResize receives a ratio cumulative from the drag start, so each
    // update re-derives the geometry from this baseline rather than compounding.
    this.resizeBaseGeom = [...this.geom];
  }

  /**
   * Resize by baking the drag ratio into the geometry and leaving `scale` at 1.
   * Unlike the base implementation (which scales via a render-time ctx.scale and
   * stretches the stroke width), this moves the shape's points so the outline
   * thickness stays `style.size`. Offset math mirrors the base to keep the
   * anchor side pinned.
   */
  public override applyResize(opts: {
    handle: ResizeHandle;
    originalScale: Vector2;
    originalOffset: Vector2;
    ratioX: number;
    ratioY: number;
    anchorWorld: Vector2;
  }): void {
    const { handle: h, originalOffset, ratioX, ratioY, anchorWorld } = opts;
    const base = this.resizeBaseGeom ?? this.geom;
    const sx = h.scaleX ? Math.max(MIN_SCALE, ratioX) : 1;
    const sy = h.scaleY ? Math.max(MIN_SCALE, ratioY) : 1;
    this.setGeom(scaleGeom(this.shapeType, base, sx, sy));

    // Re-pin the anchor side against the freshly scaled local bbox.
    const local = this.localBoundingBox;
    const localAnchorX = local.x + local.width * h.anchorFx;
    const localAnchorY = local.y + local.height * h.anchorFy;
    const newOffsetX = h.scaleX
      ? anchorWorld.x - h.anchorPad.x - localAnchorX
      : originalOffset.x;
    const newOffsetY = h.scaleY
      ? anchorWorld.y - h.anchorPad.y - localAnchorY
      : originalOffset.y;
    this.setOffset(newOffsetX, newOffsetY);
  }

  public override endResize(): void {
    this.resizeBaseGeom = null;
    this.updateBounds();
  }

  /** Replace the geometry and mirror it into the backing Y.Map value. */
  private setGeom(geom: number[]): void {
    this.geom = geom;
    this.updateBoundingBox();
    this.syncToYMap({ geom: [...geom] });
  }

  protected draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
    const g = this.geom;
    if (g.length < 4) {
      return;
    }
    ctx.strokeStyle = resolveInkColor(this.style.color);
    ctx.lineWidth = this.style.size;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    switch (this.shapeType) {
      case 'rect':
        ctx.rect(g[0], g[1], g[2], g[3]);
        break;
      case 'ellipse': {
        const cx = g[0] + g[2] / 2;
        const cy = g[1] + g[3] / 2;
        ctx.ellipse(cx, cy, g[2] / 2, g[3] / 2, 0, 0, Math.PI * 2);
        break;
      }
      case 'line':
        ctx.moveTo(g[0], g[1]);
        ctx.lineTo(g[2], g[3]);
        break;
      case 'triangle':
        ctx.moveTo(g[0], g[1]);
        ctx.lineTo(g[2], g[3]);
        ctx.lineTo(g[4], g[5]);
        ctx.closePath();
        break;
    }
    ctx.stroke();
  }

  protected isOverLocal(
    x: number,
    y: number,
    radius: number,
    _ctx: CanvasRenderingContext2D,
  ): boolean {
    const g = this.geom;
    const tol = radius + this.style.size / 2;
    switch (this.shapeType) {
      case 'line':
        return distToSegment(x, y, g[0], g[1], g[2], g[3]) <= tol;
      case 'rect': {
        const edges = rectEdges(g);
        return edges.some(
          ([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) <= tol,
        );
      }
      case 'triangle': {
        const edges: [number, number, number, number][] = [
          [g[0], g[1], g[2], g[3]],
          [g[2], g[3], g[4], g[5]],
          [g[4], g[5], g[0], g[1]],
        ];
        return edges.some(
          ([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) <= tol,
        );
      }
      case 'ellipse':
        return distToEllipseBoundary(x, y, g) <= tol;
      default:
        return false;
    }
  }

  public override drawToPdf(ctx: PdfHarvestContext): void {
    const g = this.geom;
    if (g.length < 4) {
      return;
    }
    // World-space polyline for this shape (PageItem.path has no line width, so
    // shapes are emitted as width-carrying `line` segments instead).
    const worldPts = this.toWorldOutline();

    // Measured off the outline, not boundingBox — the latter is inflated to the
    // stroke thickness for hit-testing, which would hide degenerate geometry.
    const xs = worldPts.map(([x]) => x);
    const ys = worldPts.map(([, y]) => y);
    if (
      Math.max(...xs) - Math.min(...xs) < MIN_PDF_WORLD_SIZE &&
      Math.max(...ys) - Math.min(...ys) < MIN_PDF_WORLD_SIZE
    ) {
      return;
    }
    const { rgb } = parseCssColor(this.style.color);
    const width = ctx.ptPerWorldY * this.style.size;
    const closed =
      this.shapeType === 'rect' ||
      this.shapeType === 'triangle' ||
      this.shapeType === 'ellipse';

    const last = worldPts.length - 1;
    for (let i = 0; i < last; i++) {
      const p1 = ctx.worldToPagePt(worldPts[i][0], worldPts[i][1]);
      const p2 = ctx.worldToPagePt(worldPts[i + 1][0], worldPts[i + 1][1]);
      ctx.push({
        t: 'line',
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        color: rgb,
        width,
      });
    }
    if (closed && worldPts.length >= 2) {
      const p1 = ctx.worldToPagePt(worldPts[last][0], worldPts[last][1]);
      const p2 = ctx.worldToPagePt(worldPts[0][0], worldPts[0][1]);
      ctx.push({
        t: 'line',
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        color: rgb,
        width,
      });
    }
  }

  /** Local→world outline as an ordered list of vertices (open for line). */
  private toWorldOutline(): [number, number][] {
    const g = this.geom;
    const sx = this.scale.x;
    const sy = this.scale.y;
    const ox = this.offset.x;
    const oy = this.offset.y;
    const toWorld = (lx: number, ly: number): [number, number] => [
      lx * sx + ox,
      ly * sy + oy,
    ];
    switch (this.shapeType) {
      case 'line':
        return [toWorld(g[0], g[1]), toWorld(g[2], g[3])];
      case 'rect':
        return rectCorners(g).map(([x, y]) => toWorld(x, y));
      case 'triangle':
        return [toWorld(g[0], g[1]), toWorld(g[2], g[3]), toWorld(g[4], g[5])];
      case 'ellipse': {
        const cx = g[0] + g[2] / 2;
        const cy = g[1] + g[3] / 2;
        const rx = g[2] / 2;
        const ry = g[3] / 2;
        const out: [number, number][] = [];
        for (let i = 0; i < ELLIPSE_PDF_SEGMENTS; i++) {
          const a = (i / ELLIPSE_PDF_SEGMENTS) * Math.PI * 2;
          out.push(toWorld(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
        }
        return out;
      }
    }
  }
}

function scaleGeom(
  shapeType: ShapeType,
  geom: number[],
  sx: number,
  sy: number,
): number[] {
  // Geometry lives in a local frame anchored at (0,0); scaling about the origin
  // resizes the shape while keeping that anchor fixed.
  if (shapeType === 'rect' || shapeType === 'ellipse') {
    return [geom[0] * sx, geom[1] * sy, geom[2] * sx, geom[3] * sy];
  }
  const out = new Array<number>(geom.length);
  for (let i = 0; i + 1 < geom.length; i += 2) {
    out[i] = geom[i] * sx;
    out[i + 1] = geom[i + 1] * sy;
  }
  return out;
}

function rectCorners(g: number[]): [number, number][] {
  const [x, y, w, h] = g;
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

function rectEdges(g: number[]): [number, number, number, number][] {
  const c = rectCorners(g);
  return [
    [c[0][0], c[0][1], c[1][0], c[1][1]],
    [c[1][0], c[1][1], c[2][0], c[2][1]],
    [c[2][0], c[2][1], c[3][0], c[3][1]],
    [c[3][0], c[3][1], c[0][0], c[0][1]],
  ];
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) {
    return Math.hypot(px - ax, py - ay);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Approximate distance from a point to an ellipse boundary (box = [x,y,w,h]). */
function distToEllipseBoundary(px: number, py: number, g: number[]): number {
  const cx = g[0] + g[2] / 2;
  const cy = g[1] + g[3] / 2;
  const rx = g[2] / 2;
  const ry = g[3] / 2;
  if (rx <= 1e-6 || ry <= 1e-6) {
    return Math.hypot(px - cx, py - cy);
  }
  // Sample the boundary and take the nearest vertex — cheap and adequate for
  // hit-testing tolerance.
  let best = Number.POSITIVE_INFINITY;
  const segs = 48;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const bx = cx + Math.cos(a) * rx;
    const by = cy + Math.sin(a) * ry;
    const d = Math.hypot(px - bx, py - by);
    if (d < best) {
      best = d;
    }
  }
  return best;
}
