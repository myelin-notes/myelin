import { PenToolIcon } from 'lucide-react';
import type * as Y from 'yjs';
import { resolveInkColor } from '../canvas-theme';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type { Messages } from '../i18n/messages';
import { parseCssColor } from '../pdf-export/color';
import type { PdfHarvestContext } from '../pdf-export/harvest';
import type { ShapeType } from '../shape-recognizer';
import {
  DrawableElement,
  MIN_SCALE,
  type ResizeHandle,
  ResizeHandles,
  type SelectionToolbarItem,
} from './drawable-element';
import { ElementType } from './element-type';
import type { StrokeStyle } from './stroke-element';

/** Number of segments used to approximate an ellipse outline in PDF export. */
const ELLIPSE_PDF_SEGMENTS = 32;
/** Skip PDF output when the world-space bbox is smaller than this (avoids degenerate paths). */
const MIN_PDF_WORLD_SIZE = 1;

/**
 * Parametric vector shape from the draw-and-hold recognizer. Geometry is stored once in a
 * normalized local frame, so world placement, resize, translate and undo are inherited from the
 * base class transform machinery.
 */
export class ShapeElement extends DrawableElement {
  protected box: DOMRect = new DOMRect(0, 0, 0, 0);

  /** Pre-drag geometry snapshot; resize ratios are cumulative from drag start. */
  private resizeBaseGeom: number[] | null = null;
  private editingPoints = false;

  public constructor(
    uuid: string,
    public shapeType: ShapeType,
    protected geom: number[],
    protected style: StrokeStyle,
  ) {
    super(uuid, ElementType.SHAPE);
    this.geom = normalizeGeom(shapeType, geom);
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
        this.geom = normalizeGeom(this.shapeType, v as number[]);
        this.updateBounds();
      },
    });
  }

  public get localBoundingBox(): DOMRect {
    return this.box;
  }

  // A snapped horizontal line has an exactly-zero-height geometry bbox, which no box test can hit:
  // `inBox` uses strict inequalities, marquee needs a non-zero area, and resize bails on an empty box.
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
    if (this.shapeType === 'ellipse') {
      if (g.length < 4) {
        this.box = new DOMRect(0, 0, 0, 0);
        return;
      }
      this.box = this.withStrokeThickness(new DOMRect(g[0], g[1], g[2], g[3]));
      return;
    }
    // line / rectangle / triangle: min/max of flat coordinate pairs.
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

  public override get hasControlPoints(): boolean {
    return this.editingPoints;
  }

  public override get editable(): boolean {
    return true;
  }

  public override get entersEditOnSelectedClick(): boolean {
    return false;
  }

  public override enterEditMode(_canvas: DrawableCanvas): HTMLElement | null {
    this.editingPoints = true;
    return null;
  }

  public override exitEditMode(): void {
    this.editingPoints = false;
  }

  public override getSelectionToolbarItems(
    strings: Messages,
    canvas?: DrawableCanvas,
  ): SelectionToolbarItem[] {
    if (!canvas) {
      return [];
    }
    return [
      {
        id: 'edit-points',
        label: this.editingPoints
          ? strings.canvas.selectionToolbar.finishEditingPoints
          : strings.canvas.selectionToolbar.editPoints,
        icon: PenToolIcon,
        active: this.editingPoints,
        onClick: () => {
          if (this.editingPoints) {
            canvas.exitElementEdit();
          } else {
            canvas.enterElementEdit(this);
          }
        },
      },
    ];
  }

  public override getHandles(): ResizeHandle[] {
    if (!this.editingPoints) {
      return super.getHandles();
    }
    if (this.shapeType === 'ellipse') {
      const [x, y, width, height] = this.geom;
      const center = this.localToWorld(x + width / 2, y + height / 2);
      return [
        {
          position: this.localToWorld(x + width, y + height / 2),
          anchor: center,
          anchorPad: { x: 0, y: 0 },
          anchorFx: 0.5,
          anchorFy: 0.5,
          scaleX: true,
          scaleY: true,
          cursor: 'move',
          control: { kind: 'radius' },
        },
      ];
    }

    const handles: ResizeHandle[] = [];
    for (let i = 0; i + 1 < this.geom.length; i += 2) {
      const opposite = this.oppositeVertex(i);
      const anchor = this.localToWorld(opposite.x, opposite.y);
      handles.push({
        position: this.localToWorld(this.geom[i], this.geom[i + 1]),
        anchor,
        anchorPad: { x: 0, y: 0 },
        anchorFx: fractionWithin(opposite.x, this.box.x, this.box.width),
        anchorFy: fractionWithin(opposite.y, this.box.y, this.box.height),
        scaleX: true,
        scaleY: true,
        cursor: 'move',
        control: { kind: 'vertex', index: i },
      });
    }
    return handles;
  }

  public override beginResize(): void {
    // applyResize receives a ratio cumulative from the drag start, so each
    // update re-derives the geometry from this baseline rather than compounding.
    this.resizeBaseGeom = [...this.geom];
  }

  // Bakes the drag ratio into the geometry and leaves `scale` at 1, unlike the base implementation
  // (render-time ctx.scale), so the outline thickness stays `style.size`. Offset math mirrors the
  // base to keep the anchor side pinned.
  public override applyResize(opts: {
    handle: ResizeHandle;
    originalScale: Vector2;
    originalOffset: Vector2;
    ratioX: number;
    ratioY: number;
    anchorWorld: Vector2;
    pointerWorld?: Vector2;
  }): void {
    const {
      handle: h,
      originalOffset,
      ratioX,
      ratioY,
      anchorWorld,
      pointerWorld,
    } = opts;
    const base = this.resizeBaseGeom ?? this.geom;
    if (h.control && pointerWorld) {
      const local = this.worldToLocal(pointerWorld);
      if (h.control.kind === 'vertex') {
        const next = [...base];
        next[h.control.index] = local.x;
        next[h.control.index + 1] = local.y;
        this.setGeom(next);
      } else {
        const cx = base[0] + base[2] / 2;
        const cy = base[1] + base[3] / 2;
        const radius = Math.hypot(local.x - cx, local.y - cy);
        this.setGeom([cx - radius, cy - radius, radius * 2, radius * 2]);
      }
      return;
    }
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

  /** Replace the local-frame geometry and mirror it into the backing Y.Map value. */
  public setGeom(geom: number[]): void {
    this.geom = normalizeGeom(this.shapeType, geom);
    this.updateBoundingBox();
    this.syncToYMap({ geom: [...this.geom] });
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
        ctx.moveTo(g[0], g[1]);
        for (let i = 2; i + 1 < g.length; i += 2) {
          ctx.lineTo(g[i], g[i + 1]);
        }
        ctx.closePath();
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
        const edges = polygonEdges(g);
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
        return coordinatePairs(g).map(([x, y]) => toWorld(x, y));
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

  private localToWorld(x: number, y: number): Vector2 {
    return {
      x: x * this.scale.x + this.offset.x,
      y: y * this.scale.y + this.offset.y,
    };
  }

  private worldToLocal(point: Vector2): Vector2 {
    return {
      x: (point.x - this.offset.x) / this.scale.x,
      y: (point.y - this.offset.y) / this.scale.y,
    };
  }

  private oppositeVertex(index: number): Vector2 {
    if (this.shapeType === 'line') {
      const opposite = index === 0 ? 2 : 0;
      return { x: this.geom[opposite], y: this.geom[opposite + 1] };
    }
    if (this.shapeType === 'rect') {
      const opposite = (index + 4) % 8;
      return { x: this.geom[opposite], y: this.geom[opposite + 1] };
    }
    return {
      x: (this.geom[0] + this.geom[2] + this.geom[4]) / 3,
      y: (this.geom[1] + this.geom[3] + this.geom[5]) / 3,
    };
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
  if (shapeType === 'ellipse') {
    return [geom[0] * sx, geom[1] * sy, geom[2] * sx, geom[3] * sy];
  }
  const out = new Array<number>(geom.length);
  for (let i = 0; i + 1 < geom.length; i += 2) {
    out[i] = geom[i] * sx;
    out[i + 1] = geom[i + 1] * sy;
  }
  return out;
}

function normalizeGeom(shapeType: ShapeType, geom: number[]): number[] {
  if (shapeType !== 'rect' || geom.length !== 4) {
    return geom.slice();
  }
  const [x, y, width, height] = geom;
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ].flat();
}

function coordinatePairs(g: number[]): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < g.length; i += 2) {
    points.push([g[i], g[i + 1]]);
  }
  return points;
}

function polygonEdges(g: number[]): [number, number, number, number][] {
  const points = coordinatePairs(g);
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return [point[0], point[1], next[0], next[1]];
  });
}

function fractionWithin(value: number, start: number, length: number): number {
  return length === 0 ? 0.5 : (value - start) / length;
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
