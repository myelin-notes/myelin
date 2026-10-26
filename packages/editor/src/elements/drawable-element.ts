import type { LucideIcon } from 'lucide-react';
import type * as Y from 'yjs';
import { getCanvasPalette } from '../canvas-theme';
import type { CanvasViewport } from '../canvas-viewport';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import { rotateVector } from '../geometry';
import type { Messages } from '../i18n/messages';
import type { PdfHarvestContext } from '../pdf-export/harvest';
import { CollisionHelper } from '../utils/collision-helper';
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
// World units, like the resize handles drawn beside it.
const ROTATE_KNOB_DISTANCE = 20;
export const ROTATE_KNOB_RADIUS = 4;

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
  /** Shape-owned control point or the rotate knob; absent for ordinary bounding-box handles. */
  control?:
    | { kind: 'vertex'; index: number }
    | { kind: 'radius' }
    | { kind: 'rotate' };
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
  rotateKnob = false,
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

  if (rotateKnob) {
    const knobY = y - ROTATE_KNOB_DISTANCE * eased;
    const knobR = ROTATE_KNOB_RADIUS * eased;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, knobY + knobR);
    ctx.stroke();
    ctx.fillStyle = palette.surface;
    ctx.beginPath();
    ctx.arc(x + w / 2, knobY, knobR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

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

/** Draw element-specific control points in world coordinates. */
export function drawControlPoints(
  ctx: CanvasRenderingContext2D,
  handles: readonly ResizeHandle[],
  progress: number,
): void {
  const eased = 1 - (1 - progress) * (1 - progress);
  const size = HANDLE_SIZE * eased;
  const half = size / 2;
  const radius = 1.5 * eased;
  const palette = getCanvasPalette();

  ctx.globalAlpha = eased;
  for (const handle of handles) {
    ctx.fillStyle = palette.surface;
    ctx.beginPath();
    ctx.roundRect(
      handle.position.x - half,
      handle.position.y - half,
      size,
      size,
      radius,
    );
    ctx.fill();

    ctx.strokeStyle = palette.selectionStroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(
      handle.position.x - half,
      handle.position.y - half,
      size,
      size,
      radius,
    );
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

/** The rotate knob above a selection envelope, in the same space as `box`. */
export function getRotateKnobHandle(box: DOMRect): ResizeHandle {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return {
    position: {
      x: center.x,
      y: box.y - SELECTION_PADDING - ROTATE_KNOB_DISTANCE,
    },
    anchor: center,
    anchorPad: { x: 0, y: 0 },
    anchorFx: 0.5,
    anchorFy: 0.5,
    scaleX: false,
    scaleY: false,
    cursor: 'grab',
    control: { kind: 'rotate' },
  };
}

const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

/** Maps a handle built on an element's own axes into world space by turning it `angle` radians. */
export function rotateHandle(
  handle: ResizeHandle,
  angle: number,
): ResizeHandle {
  if (angle === 0) {
    return handle;
  }
  // Direction the handle drags in, from the box center, picks one of the four two-way cursors.
  const dir = rotateVector(
    { x: 1 - 2 * handle.anchorFx, y: 1 - 2 * handle.anchorFy },
    angle,
  );
  const octant = Math.round(Math.atan2(dir.y, dir.x) / (Math.PI / 4));
  return {
    ...handle,
    position: rotateVector(handle.position, angle),
    anchor: rotateVector(handle.anchor, angle),
    cursor: handle.control
      ? handle.cursor
      : RESIZE_CURSORS[((octant % 4) + 4) % 4],
  };
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

const extent = [0, 0, 0, 0];

export abstract class DrawableElement {
  protected _scale: Vector2 = { x: 1, y: 1 };
  private _offset: Vector2 = { x: 0, y: 0 };
  // Radians about the local origin: world = offset + rotate(scale * local).
  private _rotation = 0;
  private selected: boolean = false;
  private worldBounds: DOMRect | null = null;
  private _hidden: boolean = false;
  private _locked: boolean = false;
  public onSelectionChanged?: () => void;
  public onLockChanged?: () => void;
  public onTransformChanged?: () => void;
  /**
   * Call when something `draw` or `syncDOM` reads changed outside the Y doc and input events (an
   * async decode or load finishing). The canvas only redraws on demand, so it is otherwise stale.
   */
  public onRedrawNeeded?: () => void;

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
  public get rotation(): number {
    return this._rotation;
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
      rotation: (v) => {
        this._rotation = v as number;
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
      // Undoing an element's first rotation deletes the key rather than writing 0.
      if (
        changedKeys.includes('rotation') &&
        this._yMap.get('rotation') === undefined
      ) {
        this._rotation = 0;
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
    this.setOffset(this.offset.x + dx, this.offset.y + dy);
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

  // Turns about the local origin, so `offset` is unchanged. Callers pivoting elsewhere re-translate.
  public setRotation(rotation: number) {
    this._rotation = rotation;
    this.syncToYMap({ rotation });
    this.onTransformChanged?.();
  }

  public localToWorld(x: number, y: number): Vector2 {
    const p = rotateVector(
      { x: x * this._scale.x, y: y * this._scale.y },
      this._rotation,
    );
    return { x: p.x + this.offset.x, y: p.y + this.offset.y };
  }

  public worldToLocal(point: Vector2): Vector2 {
    const p = rotateVector(
      { x: point.x - this.offset.x, y: point.y - this.offset.y },
      -this._rotation,
    );
    return { x: p.x / this._scale.x, y: p.y / this._scale.y };
  }

  // Resize math runs along the element's own axes; this sets an offset expressed in them.
  protected setOffsetAlongAxes(x: number, y: number): void {
    const offset = rotateVector({ x, y }, this._rotation);
    this.setOffset(offset.x, offset.y);
  }

  public get hidden(): boolean {
    return this._hidden;
  }
  public set hidden(value: boolean) {
    if (this._hidden === value) {
      return;
    }
    this._hidden = value;
    this.onRedrawNeeded?.();
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
    ctx.translate(this.offset.x, this.offset.y);
    ctx.rotate(this._rotation);
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

  /**
   * Whether a sole selection of this element shows the rotate knob right now. DOM-backed elements
   * keep this off: `syncDOM` positions their overlay unrotated.
   */
  public get rotatable(): boolean {
    return false;
  }

  /** Whether a click on an already-selected element should enter its edit mode. */
  public get entersEditOnSelectedClick(): boolean {
    return true;
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
  public syncDOM(
    _viewport: CanvasViewport,
    _host: HTMLElement,
    _visibleElements?: readonly DrawableElement[],
  ): void {}

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

  /**
   * The element's box along its own axes: world space turned by `-rotation` about the origin, so
   * rotating it by `rotation` lays it over the element. Equals `boundingBox` when unrotated.
   */
  public get orientedBox(): DOMRect {
    const raw = this.localBoundingBox;
    const origin = rotateVector(this.offset, -this._rotation);
    const x1 = raw.x * this._scale.x + origin.x;
    const y1 = raw.y * this._scale.y + origin.y;
    const x2 = (raw.x + raw.width) * this._scale.x + origin.x;
    const y2 = (raw.y + raw.height) * this._scale.y + origin.y;
    return new DOMRect(
      Math.min(x1, x2),
      Math.min(y1, y2),
      Math.abs(x2 - x1),
      Math.abs(y2 - y1),
    );
  }

  // Writes the world-axis extent [minX, minY, maxX, maxY] into `out` so the per-frame cull allocates
  // nothing for unrotated elements.
  private worldExtent(out: number[]): void {
    const raw = this.localBoundingBox;
    if (this._rotation === 0) {
      const x1 = raw.x * this._scale.x + this.offset.x;
      const y1 = raw.y * this._scale.y + this.offset.y;
      const x2 = (raw.x + raw.width) * this._scale.x + this.offset.x;
      const y2 = (raw.y + raw.height) * this._scale.y + this.offset.y;
      out[0] = Math.min(x1, x2);
      out[1] = Math.min(y1, y2);
      out[2] = Math.max(x1, x2);
      out[3] = Math.max(y1, y2);
      return;
    }
    const corners = [
      this.localToWorld(raw.x, raw.y),
      this.localToWorld(raw.right, raw.y),
      this.localToWorld(raw.right, raw.bottom),
      this.localToWorld(raw.x, raw.bottom),
    ];
    out[0] = Math.min(...corners.map((p) => p.x));
    out[1] = Math.min(...corners.map((p) => p.y));
    out[2] = Math.max(...corners.map((p) => p.x));
    out[3] = Math.max(...corners.map((p) => p.y));
  }

  /** Read-only world-axis bounds (of the turned box when rotated); reused until the geometry changes. */
  public get boundingBox(): DOMRect {
    this.worldExtent(extent);
    const x = extent[0];
    const y = extent[1];
    const width = extent[2] - extent[0];
    const height = extent[3] - extent[1];
    const cached = this.worldBounds;
    if (
      !cached ||
      cached.x !== x ||
      cached.y !== y ||
      cached.width !== width ||
      cached.height !== height
    ) {
      this.worldBounds = new DOMRect(x, y, width, height);
    }
    return this.worldBounds!;
  }

  // Same geometry as intersecting `boundingBox`, but without the DOMRect it allocates — the
  // renderer asks this of every element, every frame.
  public intersectsWorldRect(rect: DOMRect, margin: number): boolean {
    this.worldExtent(extent);
    return (
      extent[2] >= rect.x - margin &&
      extent[0] <= rect.right + margin &&
      extent[3] >= rect.y - margin &&
      extent[1] <= rect.bottom + margin
    );
  }

  /** Whether a world point falls inside the element's (possibly rotated) box. */
  public containsPoint(point: Vector2): boolean {
    return CollisionHelper.inBox(
      this.worldToLocal(point),
      this.localBoundingBox,
    );
  }

  /** World-space hit test, delegates to local-space after transforming coords */
  public isOver(
    x: number,
    y: number,
    radius: number,
    ctx: CanvasRenderingContext2D,
  ): boolean {
    const local = this.worldToLocal({ x, y });
    const localRadius =
      radius / Math.min(Math.abs(this._scale.x), Math.abs(this._scale.y));
    return this.isOverLocal(local.x, local.y, localRadius, ctx);
  }

  // Override to disable axes that don't make sense (e.g. page frames don't scale vertically).
  public get resizeHandles(): ResizeHandles {
    return ResizeHandles.All;
  }

  /** Whether a single selection uses geometry-owned handles instead of its bounding box. */
  public get hasControlPoints(): boolean {
    return false;
  }

  /** Force uniform scaling on corner drags (shift-key behavior, always on). */
  public get maintainAspectRatio(): boolean {
    return false;
  }

  /** Enabled resize handles in world space, with anchor & axis info. `anchorPad` is along the element's axes. */
  public getHandles(): ResizeHandle[] {
    return getResizeHandles(this.orientedBox, this.resizeHandles).map(
      (handle) => rotateHandle(handle, this._rotation),
    );
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
  public getSelectionToolbarItems(
    _strings: Messages,
    _canvas?: DrawableCanvas,
  ): SelectionToolbarItem[] {
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
    pointerWorld?: Vector2;
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
    const anchor = rotateVector(anchorWorld, -this._rotation);
    const original = rotateVector(originalOffset, -this._rotation);
    const newOffsetX = h.scaleX
      ? anchor.x - h.anchorPad.x - localAnchorX * newScaleX
      : original.x;
    const newOffsetY = h.scaleY
      ? anchor.y - h.anchorPad.y - localAnchorY * newScaleY
      : original.y;
    this.setOffsetAlongAxes(newOffsetX, newOffsetY);
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
