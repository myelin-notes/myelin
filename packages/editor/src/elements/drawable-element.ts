import type { LucideIcon } from 'lucide-react';
import type * as Y from 'yjs';
import { getCanvasPalette } from '../canvas-theme';
import type { CanvasViewport } from '../canvas-viewport';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type { Messages } from '../i18n/messages';
import type { PdfHarvestContext } from '../pdf-export/harvest';
import { applyYFields, writeYMap, type YFieldMap } from '../y-fields';
import type { SyncOrigin, YDocManager } from '../ydoc-manager';
import type { CanvasElementContext } from './canvas-element-context';
import { type ElementType, isBackgroundElement } from './element-type';

export interface SelectionToolbarItem {
  /** Stable id within an element's items, used as React key. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Render the button in an active/pressed style. */
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const HANDLE_SIZE = 6;
const SELECTION_PADDING = 4;
const SELECTION_RADIUS = 4;

// Screen-space radius (px) for grabbing a resize handle, divided by zoom for world tolerance.
const HANDLE_HIT_RADIUS = 10;

// The same target for a fingertip, nearer the ~44pt Apple asks for. Touch call sites opt in
// through `hitHandle`, so mouse and pen keep the tighter radius.
export const HANDLE_TOUCH_HIT_RADIUS = 22;

export const MIN_SCALE = 0.05;

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

/** Draw a selection envelope in world coordinates. */
export function drawSelectionBounds(
  ctx: CanvasRenderingContext2D,
  box: DOMRect,
  progress: number,
  isEditing: boolean,
  resizeHandles: ResizeHandles,
): void {
  const eased = 1 - (1 - progress) * (1 - progress);
  const pad = SELECTION_PADDING * eased;
  const x = box.x - pad;
  const y = box.y - pad;
  const w = box.width + pad * 2;
  const h = box.height + pad * 2;
  const r = SELECTION_RADIUS * eased;
  const palette = getCanvasPalette();

  ctx.globalAlpha = eased;

  if (!isEditing) {
    ctx.fillStyle = palette.selectionFill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }

  ctx.strokeStyle = palette.selectionStroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.stroke();

  const size = HANDLE_SIZE * eased;
  const half = size / 2;
  const radius = 1.5 * eased;

  for (const spec of HANDLE_SPECS) {
    if (!(resizeHandles & spec.flag)) {
      continue;
    }
    const cx = x + w * spec.fx - half;
    const cy = y + h * spec.fy - half;

    ctx.fillStyle = palette.surface;
    ctx.beginPath();
    ctx.roundRect(cx, cy, size, size, radius);
    ctx.fill();

    ctx.strokeStyle = palette.selectionStroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx, cy, size, size, radius);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/** Build resize handles for a world-space selection envelope. */
export function getResizeHandles(
  box: DOMRect,
  flags: ResizeHandles,
): ResizeHandle[] {
  if (flags === ResizeHandles.None) {
    return [];
  }
  const result: ResizeHandle[] = [];

  for (const spec of HANDLE_SPECS) {
    if (!(flags & spec.flag)) {
      continue;
    }
    const fxA = 1 - spec.fx;
    const fyA = 1 - spec.fy;
    result.push({
      position: {
        x: box.x + box.width * spec.fx + (2 * spec.fx - 1) * SELECTION_PADDING,
        y: box.y + box.height * spec.fy + (2 * spec.fy - 1) * SELECTION_PADDING,
      },
      anchor: {
        x: box.x + box.width * fxA + (2 * fxA - 1) * SELECTION_PADDING,
        y: box.y + box.height * fyA + (2 * fyA - 1) * SELECTION_PADDING,
      },
      anchorPad: {
        x: (2 * fxA - 1) * SELECTION_PADDING,
        y: (2 * fyA - 1) * SELECTION_PADDING,
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

/** Return the nearest resize handle within the pointer-specific screen-space radius. */
export function hitResizeHandle(
  handles: readonly ResizeHandle[],
  point: Vector2,
  zoom: number,
  touch = false,
): ResizeHandle | null {
  const hitRadius =
    (touch ? HANDLE_TOUCH_HIT_RADIUS : HANDLE_HIT_RADIUS) / zoom;
  let best: ResizeHandle | null = null;
  let bestDistSq = hitRadius * hitRadius;
  for (const handle of handles) {
    const dx = point.x - handle.position.x;
    const dy = point.y - handle.position.y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq) {
      best = handle;
      bestDistSq = distSq;
    }
  }
  return best;
}

export abstract class DrawableElement {
  protected _scale: Vector2 = { x: 1, y: 1 };
  private _offset: Vector2 = { x: 0, y: 0 };
  private selected: boolean = false;
  private _hidden: boolean = false;
  private _locked: boolean = false;
  public onSelectionChanged?: () => void;
  public onLockChanged?: () => void;
  public onTransformChanged?: () => void;

  /** Yjs backing map — set after element is bound to a Y.Doc. */
  protected _yMap: Y.Map<unknown> | null = null;
  private _yFields: YFieldMap = {};

  protected constructor(
    // Keys element-owned Yjs state such as page-frame ProseMirror fragments.
    public readonly uuid: string,
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

  // Future remote changes arrive via syncFromYMap.
  public bindToYMap(yMap: Y.Map<unknown>): void {
    this._yMap = yMap;
    this._yFields = {};
    this.bindYFields(yMap, {
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
      locked: (v) => {
        const locked = v === true;
        if (this._locked !== locked) {
          this._locked = locked;
          this.onLockChanged?.();
        }
      },
    });
  }

  protected bindYFields(yMap: Y.Map<unknown>, fields: YFieldMap): void {
    Object.assign(this._yFields, fields);
    applyYFields(yMap, fields);
  }

  /** Apply changed Y.Map fields after the canvas observes a remote update. */
  public syncFromYMap(keys: Iterable<string>): void {
    if (this._yMap) {
      const changedKeys = Array.from(keys);
      applyYFields(this._yMap, this._yFields, changedKeys);
      if (
        changedKeys.includes('locked') &&
        this._yMap.get('locked') === undefined &&
        this._locked
      ) {
        this._locked = false;
        this.onLockChanged?.();
      }
    }
  }

  /** Write key-value pairs to the backing Y.Map in a single transaction. */
  protected syncToYMap(
    updates: Record<string, unknown>,
    origin?: SyncOrigin,
  ): void {
    if (this._yMap) {
      writeYMap(this._yMap, updates, origin);
    }
  }

  public translate(dx: number, dy: number) {
    if (dx === 0 && dy === 0) {
      return;
    }
    this._offset.x += dx;
    this._offset.y += dy;
    this.syncToYMap({ offsetX: this._offset.x, offsetY: this._offset.y });
    this.onTransformChanged?.();
  }

  public setOffset(x: number, y: number) {
    this._offset = { x, y };
    this.syncToYMap({ offsetX: x, offsetY: y });
    this.onTransformChanged?.();
  }

  public setScale(x: number, y: number) {
    this._scale = { x, y };
    this.updateBoundingBox();
    this.syncToYMap({ scaleX: x, scaleY: y });
    this.onTransformChanged?.();
  }

  public get hidden(): boolean {
    return this._hidden;
  }
  public set hidden(value: boolean) {
    this._hidden = value;
  }

  public get locked(): boolean {
    return this._locked;
  }

  public setLocked(locked: boolean): void {
    if (this._locked === locked) {
      return;
    }
    this._locked = locked;
    this.syncToYMap({ locked });
    this.onLockChanged?.();
  }

  /** Draw element content. The renderer draws the shared selection overlay separately. */
  public draw(ctx: CanvasRenderingContext2D, deltaTime: number): void {
    if (this._hidden) {
      return;
    }
    ctx.save();
    ctx.translate(this._offset.x, this._offset.y);
    ctx.scale(this._scale.x, this._scale.y);
    this.draw2D(ctx, deltaTime);
    ctx.restore();
  }

  // Emitted when this element overlays a PDF element being exported. Drawable overlays override.
  public drawToPdf(_ctx: PdfHarvestContext): void {}

  // Async-rendering elements (e.g. PDF) override to prepare their raster ahead of `drawThumbnail`.
  public async prepareThumbnail(
    _maxScale: number,
    _region: DOMRect,
  ): Promise<void> {}

  // e.g. rasterizing HTML/math to a bitmap. The export path awaits this for each overlay element.
  public async prepareForPdf(): Promise<void> {}

  // Reuses the 2D draw pass by default; DOM-backed elements override to paint their content.
  public drawThumbnail(ctx: CanvasRenderingContext2D, deltaTime: number): void {
    this.draw2D(ctx, deltaTime);
  }

  public select() {
    if (this.selected) {
      return;
    }
    this.selected = true;
    this.onSelectionChanged?.();
  }

  public unselect() {
    if (!this.selected) {
      return;
    }
    this.selected = false;
    this.onSelectionChanged?.();
  }

  /** Whether this element supports inline editing (double-click to edit). */
  public get editable(): boolean {
    return false;
  }

  // An unselected backdrop says no: its body covers the area gestures travel across, so a drag
  // starting there belongs to whatever is drawn on top of it (a marquee, or a one-finger pan).
  public get grabsFromBody(): boolean {
    return this.isSelected || !isBackgroundElement(this.type);
  }

  // Elements whose toolbar acts on the thing being edited (text style controls) want this;
  // elements carrying their own in-place editing chrome don't.
  public get keepsSelectionToolbarWhileEditing(): boolean {
    return false;
  }

  // A paged-surface behavior — only multi-page elements like the page frame want it; free-floating
  // editors (text, LaTeX) should pan the canvas freely.
  public get locksViewportPanWhileEditing(): boolean {
    return false;
  }

  // For shared state that does not live on the element's main Y.Map.
  public bindSharedYState(_ydoc: YDocManager): void {}

  public configureCanvas(_context: CanvasElementContext): void {}

  /** Called when the element enters inline edit mode. Returns the root DOM element of the editing UI, if any. */
  public enterEditMode(
    _canvas: DrawableCanvas,
    _screenX?: number,
    _screenY?: number,
  ): HTMLElement | null {
    return null;
  }
  public exitEditMode(): void {}

  // Called once per frame from `DrawableCanvas.redraw()` after the 2D pass.
  public syncDOM(_viewport: CanvasViewport, _host: HTMLElement): void {}

  public setDomZIndex(_zIndex: string): void {}

  /** Detach any DOM this element created. Called on removal. Default: no-op. */
  public disposeDOM(): void {}

  public disposeCanvas(): void {
    this.disposeDOM();
  }

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

  // Same geometry as intersecting `boundingBox`, but without the DOMRect it allocates — the
  // renderer asks this of every element, every frame.
  public intersectsWorldRect(rect: DOMRect, margin: number): boolean {
    const raw = this.localBoundingBox;
    const x1 = raw.x * this._scale.x + this._offset.x;
    const y1 = raw.y * this._scale.y + this._offset.y;
    const x2 = (raw.x + raw.width) * this._scale.x + this._offset.x;
    const y2 = (raw.y + raw.height) * this._scale.y + this._offset.y;
    return (
      Math.max(x1, x2) >= rect.x - margin &&
      Math.min(x1, x2) <= rect.right + margin &&
      Math.max(y1, y2) >= rect.y - margin &&
      Math.min(y1, y2) <= rect.bottom + margin
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

  // Override to disable axes that don't make sense (e.g. page frames don't scale vertically).
  public get resizeHandles(): ResizeHandles {
    return ResizeHandles.All;
  }

  /** Force uniform scaling on corner drags (shift-key behavior, always on). */
  public get maintainAspectRatio(): boolean {
    return false;
  }

  /** Enabled resize handles in world space, with anchor & axis info. */
  public getHandles(): ResizeHandle[] {
    return getResizeHandles(this.boundingBox, this.resizeHandles);
  }

  // Pass `touch` for finger input, which grabs with the larger radius.
  public hitHandle(
    point: Vector2,
    zoom: number,
    touch = false,
  ): ResizeHandle | null {
    return hitResizeHandle(this.getHandles(), point, zoom, touch);
  }

  // Only when it is the sole selected element. Override to expose element-specific actions.
  public getSelectionToolbarItems(_strings: Messages): SelectionToolbarItem[] {
    return [];
  }

  /** Called once when a resize drag begins. Snapshot any baseline state here. */
  public beginResize(): void {}

  // Default scales the element and re-derives offset so the anchor side stays fixed. Override to
  // interpret the drag differently (e.g. page frame changing page width rather than scale).
  public applyResize(opts: {
    handle: ResizeHandle;
    originalScale: Vector2;
    originalOffset: Vector2;
    ratioX: number;
    ratioY: number;
    anchorWorld: Vector2;
  }): void {
    const {
      handle: h,
      originalScale,
      originalOffset,
      ratioX,
      ratioY,
      anchorWorld,
    } = opts;
    const newScaleX = h.scaleX
      ? Math.max(MIN_SCALE, originalScale.x * ratioX)
      : originalScale.x;
    const newScaleY = h.scaleY
      ? Math.max(MIN_SCALE, originalScale.y * ratioY)
      : originalScale.y;
    this.setScale(newScaleX, newScaleY);

    // Re-read local bbox post-scale: elements like text reflow on resize.
    const local = this.localBoundingBox;
    const localAnchorX = local.x + local.width * h.anchorFx;
    const localAnchorY = local.y + local.height * h.anchorFy;
    const newOffsetX = h.scaleX
      ? anchorWorld.x - h.anchorPad.x - localAnchorX * newScaleX
      : originalOffset.x;
    const newOffsetY = h.scaleY
      ? anchorWorld.y - h.anchorPad.y - localAnchorY * newScaleY
      : originalOffset.y;
    this.setOffset(newOffsetX, newOffsetY);
  }

  /** Called once when a resize drag ends (commit or interrupt). */
  public endResize(): void {}

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
