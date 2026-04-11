import type {
  BinaryReader,
  BinaryWriter,
  ISerializable,
} from '../../../lib/utils/binary-helper';
import type { UndoCommand } from '../../../lib/utils/undo-redo';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type { ElementType } from './element-type';

const SELECTION_STROKE = '#2f3e46';
const HANDLE_SIZE = 6;
const SELECTION_PADDING = 4;
const SELECTION_RADIUS = 4;
const SELECTION_ANIM_SPEED = 8;

export abstract class DrawableElement implements ISerializable {
  protected _scale: Vector2 = { x: 1, y: 1 };
  private _offset: Vector2 = { x: 0, y: 0 };
  private selected: boolean = false;
  private selectionT: number = 0;
  private _hidden: boolean = false;

  protected constructor(
    public readonly index: number,
    public readonly type: ElementType,
  ) {}

  public get offset(): Vector2 {
    return this._offset;
  }
  public get scale(): Vector2 {
    return this._scale;
  }

  public translate(dx: number, dy: number) {
    this._offset.x += dx;
    this._offset.y += dy;
  }

  public setOffset(x: number, y: number) {
    this._offset = { x, y };
  }

  public setScale(x: number, y: number) {
    this._scale = { x, y };
    this.updateBoundingBox();
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

    // Corner handles
    const handleScale = eased;
    const size = HANDLE_SIZE * handleScale;
    const half = size / 2;
    const corners: [number, number][] = [
      [x - half, y - half],
      [x + w - half, y - half],
      [x - half, y + h - half],
      [x + w - half, y + h - half],
    ];

    for (const [cx, cy] of corners) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(cx, cy, size, size, 1.5 * handleScale);
      ctx.fill();

      ctx.strokeStyle = SELECTION_STROKE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(cx, cy, size, size, 1.5 * handleScale);
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

  /** Called when the element enters inline edit mode. Returns the root DOM element of the editing UI, if any. */
  public enterEditMode(
    _canvas: DrawableCanvas,
    _screenX?: number,
    _screenY?: number,
  ): HTMLElement | null {
    return null;
  }
  /** Called when the element exits inline edit mode. Returns an undo command if the content changed. */
  public exitEditMode(): UndoCommand | null {
    return null;
  }

  public updateBounds() {
    this.updateBoundingBox();
  }

  public load(reader: BinaryReader): void {
    this._scale.x = reader.readF32();
    this._scale.y = reader.readF32();
    this._offset.x = reader.readF32();
    this._offset.y = reader.readF32();
  }

  public save(writer: BinaryWriter): void {
    writer.writeF32(this._scale.x);
    writer.writeF32(this._scale.y);
    writer.writeF32(this._offset.x);
    writer.writeF32(this._offset.y);
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

  /** Handle corner positions in world space (includes selection padding) */
  public getHandles(): Vector2[] {
    const box = this.boundingBox;
    const p = SELECTION_PADDING;
    return [
      { x: box.x - p, y: box.y - p },
      { x: box.right + p, y: box.y - p },
      { x: box.x - p, y: box.bottom + p },
      { x: box.right + p, y: box.bottom + p },
    ];
  }

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
