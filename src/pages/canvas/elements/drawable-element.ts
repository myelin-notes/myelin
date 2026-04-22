import type * as Y from 'yjs';
import type { CanvasViewport } from '../canvas-viewport';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import { bindYFields, writeYMap } from '../y-fields';
import type { YDocManager } from '../ydoc-manager';
import type { ElementType } from './element-type';

const SELECTION_STROKE = '#2f3e46';
const HANDLE_SIZE = 6;
const SELECTION_PADDING = 4;
const SELECTION_RADIUS = 4;
const SELECTION_ANIM_SPEED = 8;

export enum ResizeHandles {
  None = 0,
  TopLeft = 1 << 0,
  Top = 1 << 1,
  TopRight = 1 << 2,
  Left = 1 << 3,
  Right = 1 << 4,
  BottomLeft = 1 << 5,
  Bottom = 1 << 6,
  BottomRight = 1 << 7,
  Corners = TopLeft | TopRight | BottomLeft | BottomRight,
  HorizontalSides = Left | Right,
  VerticalSides = Top | Bottom,
  Sides = HorizontalSides | VerticalSides,
  All = Corners | Sides,
}

export interface ResizeHandle {
  /** World-space handle position (for drawing & hit-test). */
  position: Vector2;
  /** World-space fixed point on the opposite side of the element. */
  anchor: Vector2;
  /** Selection-padding baked into `anchor`, subtracted during offset re-derivation. */
  anchorPad: Vector2;
  /** Anchor fraction along width (0/0.5/1) — used to re-read local bbox mid-drag. */
  anchorFx: number;
  /** Anchor fraction along height (0/0.5/1). */
  anchorFy: number;
  scaleX: boolean;
  scaleY: boolean;
  cursor: string;
}

interface HandleSpec {
  flag: ResizeHandles;
  fx: number;
  fy: number;
  cursor: string;
}

const HANDLE_SPECS: readonly HandleSpec[] = [
  { flag: ResizeHandles.TopLeft, fx: 0, fy: 0, cursor: 'nwse-resize' },
  { flag: ResizeHandles.Top, fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { flag: ResizeHandles.TopRight, fx: 1, fy: 0, cursor: 'nesw-resize' },
  { flag: ResizeHandles.Left, fx: 0, fy: 0.5, cursor: 'ew-resize' },
  { flag: ResizeHandles.Right, fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { flag: ResizeHandles.BottomLeft, fx: 0, fy: 1, cursor: 'nesw-resize' },
  { flag: ResizeHandles.Bottom, fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { flag: ResizeHandles.BottomRight, fx: 1, fy: 1, cursor: 'nwse-resize' },
];

export abstract class DrawableElement {
  protected _scale: Vector2 = { x: 1, y: 1 };
  private _offset: Vector2 = { x: 0, y: 0 };
  private selected: boolean = false;
  private selectionT: number = 0;
  private _hidden: boolean = false;

  /** Yjs backing map — set after element is bound to a Y.Doc. */
  protected _yMap: Y.Map<unknown> | null = null;

  protected constructor(
    /**
     * Stable element identity within a canvas document.
     *
     * This is not just the current array position: it survives reordering
     * and is used to key element-owned Yjs state such as page-frame
     * ProseMirror fragments.
     */
    public readonly index: number,
    public readonly type: ElementType,
  ) {}

  public get yMap(): Y.Map<unknown> | null {
    return this._yMap;
  }

  public get offset(): Vector2 {
    return this._offset;
  }
  public get scale(): Vector2 {
    return this._scale;
  }

  /**
   * Bind this element to a Y.Map, reading initial values and observing
   * future changes. Subclasses override to bind additional fields.
   */
  public bindToYMap(yMap: Y.Map<unknown>): void {
    this._yMap = yMap;
    bindYFields(yMap, {
      offsetX: (v) => {
        this._offset.x = v as number;
      },
      offsetY: (v) => {
        this._offset.y = v as number;
      },
      scaleX: (v) => {
        this._scale.x = v as number;
        this.updateBoundingBox();
      },
      scaleY: (v) => {
        this._scale.y = v as number;
        this.updateBoundingBox();
      },
    });
  }

  /** Write key-value pairs to the backing Y.Map in a single transaction. */
  protected syncToYMap(updates: Record<string, unknown>): void {
    if (this._yMap) {
      writeYMap(this._yMap, updates);
    }
  }

  public translate(dx: number, dy: number) {
    this._offset.x += dx;
    this._offset.y += dy;
    this.syncToYMap({ offsetX: this._offset.x, offsetY: this._offset.y });
  }

  public setOffset(x: number, y: number) {
    this._offset = { x, y };
    this.syncToYMap({ offsetX: x, offsetY: y });
  }

  public setScale(x: number, y: number) {
    this._scale = { x, y };
    this.updateBoundingBox();
    this.syncToYMap({ scaleX: x, scaleY: y });
  }

  public get hidden(): boolean {
    return this._hidden;
  }
  public set hidden(value: boolean) {
    this._hidden = value;
  }

  public draw(ctx: CanvasRenderingContext2D, deltaTime: number): void {
    if (this._hidden) {
      return;
    }
    ctx.save();

    ctx.translate(this._offset.x, this._offset.y);
    ctx.scale(this._scale.x, this._scale.y);
    this.draw2D(ctx, deltaTime);

    if (this.selected) {
      this.selectionT = Math.min(
        1,
        this.selectionT + deltaTime * SELECTION_ANIM_SPEED,
      );
    }

    // Draw selection outside the element's scale transform
    ctx.restore();
    if (this.selectionT > 0) {
      ctx.save();
      ctx.translate(this._offset.x, this._offset.y);
      this.drawSelection(ctx, this.selectionT);
      ctx.restore();
    }
  }

  private drawSelection(ctx: CanvasRenderingContext2D, t: number): void {
    const local = this.localBoundingBox;
    const eased = 1 - (1 - t) * (1 - t);

    const pad = SELECTION_PADDING * eased;
    const sx = this._scale.x;
    const sy = this._scale.y;
    const x = local.x * sx - pad;
    const y = local.y * sy - pad;
    const w = local.width * sx + pad * 2;
    const h = local.height * sy + pad * 2;
    const r = SELECTION_RADIUS * eased;

    ctx.globalAlpha = eased;

    // Selection fill
    ctx.fillStyle = `rgba(208, 225, 251, 0.12)`;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();

    // Selection border
    ctx.strokeStyle = SELECTION_STROKE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();

    // Resize handles
    const flags = this.resizeHandles;
    const handleScale = eased;
    const size = HANDLE_SIZE * handleScale;
    const half = size / 2;
    const radius = 1.5 * handleScale;

    for (const spec of HANDLE_SPECS) {
      if (!(flags & spec.flag)) {
        continue;
      }
      const cx = x + w * spec.fx - half;
      const cy = y + h * spec.fy - half;

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(cx, cy, size, size, radius);
      ctx.fill();

      ctx.strokeStyle = SELECTION_STROKE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(cx, cy, size, size, radius);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  public select() {
    this.selected = true;
  }

  public unselect() {
    this.selected = false;
    this.selectionT = 0;
  }

  /** Whether this element supports inline editing (double-click to edit). */
  public get editable(): boolean {
    return false;
  }

  /**
   * Whether entering edit mode requires the foreground canvas to sit under
   * DOM-backed editing chrome owned by the element.
   */
  public get lowersCanvasWhileEditing(): boolean {
    return false;
  }

  /**
   * Hook for binding extra shared Yjs state that does not live on the
   * element's main Y.Map.
   */
  public bindSharedYState(_ydoc: YDocManager): void {}

  /** Called when the element enters inline edit mode. Returns the root DOM element of the editing UI, if any. */
  public enterEditMode(
    _canvas: DrawableCanvas,
    _screenX?: number,
    _screenY?: number,
  ): HTMLElement | null {
    return null;
  }
  /** Called when the element exits inline edit mode. */
  public exitEditMode(): void {}

  /**
   * Hook for elements that render as DOM rather than on the 2D canvas.
   * Called once per frame from `DrawableCanvas.redraw()` after the 2D pass,
   * with the shared DOM overlay host. Default: no-op.
   */
  public syncDOM(_viewport: CanvasViewport, _host: HTMLElement): void {}

  /** Detach any DOM this element created. Called on removal. Default: no-op. */
  public disposeDOM(): void {}

  public updateBounds() {
    this.updateBoundingBox();
  }

  public get isSelected() {
    return this.selected;
  }

  /** World-space bounding box (local * scale + offset) */
  public get boundingBox(): DOMRect {
    const raw = this.localBoundingBox;
    const x1 = raw.x * this._scale.x + this._offset.x;
    const y1 = raw.y * this._scale.y + this._offset.y;
    const x2 = (raw.x + raw.width) * this._scale.x + this._offset.x;
    const y2 = (raw.y + raw.height) * this._scale.y + this._offset.y;
    return new DOMRect(
      Math.min(x1, x2),
      Math.min(y1, y2),
      Math.abs(x2 - x1),
      Math.abs(y2 - y1),
    );
  }

  /** World-space hit test, delegates to local-space after transforming coords */
  public isOver(
    x: number,
    y: number,
    radius: number,
    ctx: CanvasRenderingContext2D,
  ): boolean {
    const localX = (x - this._offset.x) / this._scale.x;
    const localY = (y - this._offset.y) / this._scale.y;
    const localRadius =
      radius / Math.min(Math.abs(this._scale.x), Math.abs(this._scale.y));
    return this.isOverLocal(localX, localY, localRadius, ctx);
  }

  /**
   * Which resize handles this element exposes. Default: all 8.
   * Override per element type to disable axes that don't make sense
   * (e.g. page frames don't scale vertically).
   */
  public get resizeHandles(): ResizeHandles {
    return ResizeHandles.All;
  }

  /** Force uniform scaling on corner drags (shift-key behavior, always on). */
  public get maintainAspectRatio(): boolean {
    return false;
  }

  /** Enabled resize handles in world space, with anchor & axis info. */
  public getHandles(): ResizeHandle[] {
    const flags = this.resizeHandles;
    if (flags === ResizeHandles.None) {
      return [];
    }
    const box = this.boundingBox;
    const p = SELECTION_PADDING;
    const result: ResizeHandle[] = [];

    for (const spec of HANDLE_SPECS) {
      if (!(flags & spec.flag)) {
        continue;
      }
      const fxA = 1 - spec.fx;
      const fyA = 1 - spec.fy;
      result.push({
        position: {
          x: box.x + box.width * spec.fx + (2 * spec.fx - 1) * p,
          y: box.y + box.height * spec.fy + (2 * spec.fy - 1) * p,
        },
        anchor: {
          x: box.x + box.width * fxA + (2 * fxA - 1) * p,
          y: box.y + box.height * fyA + (2 * fyA - 1) * p,
        },
        anchorPad: {
          x: (2 * fxA - 1) * p,
          y: (2 * fyA - 1) * p,
        },
        anchorFx: fxA,
        anchorFy: fyA,
        scaleX: spec.fx !== 0.5,
        scaleY: spec.fy !== 0.5,
        cursor: spec.cursor,
      });
    }
    return result;
  }

  /** Return type-specific Y.Map properties for initial serialization. */
  public abstract getYMapProps(): Record<string, unknown>;

  /** Bounding box in element-local space (before scale/offset) */
  public abstract get localBoundingBox(): DOMRect;
  protected abstract isOverLocal(
    x: number,
    y: number,
    radius: number,
    ctx: CanvasRenderingContext2D,
  ): boolean;
  protected abstract updateBoundingBox(): void;
  protected abstract draw2D(
    ctx: CanvasRenderingContext2D,
    deltaTime: number,
  ): void;
}
