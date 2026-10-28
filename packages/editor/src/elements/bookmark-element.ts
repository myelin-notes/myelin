import type * as Y from 'yjs';
import { CollisionHelper } from '../utils/collision-helper';
import { AnchorableElement } from './anchorable-element';
import type { CanvasElementContext } from './canvas-element-context';
import { ResizeHandles } from './drawable-element';
import { ElementType } from './element-type';

const FLAG_COLOR = '#ef4444';
// Screen px around the pole's foot, which sits at the element's offset.
const FLAG_BOX = new DOMRect(-4, -28, 22, 32);

/** A review marker. Drawn at a constant screen size so it stays findable when zoomed out. */
export class BookmarkElement extends AnchorableElement {
  private _label: string;
  private getZoom: () => number = () => 1;

  constructor(uuid: string, label = '') {
    super(uuid, ElementType.BOOKMARK);
    this._label = label;
  }

  /** Empty when no context was found at placement; the UI shows a generic name. */
  public get label(): string {
    return this._label;
  }

  public setLabel(label: string): void {
    this._label = label;
    this.syncToYMap({ label });
  }

  public override get makesSpace(): boolean {
    return false;
  }

  public override get resizeHandles(): ResizeHandles {
    return ResizeHandles.None;
  }

  public override configureCanvas(context: CanvasElementContext): void {
    if (context.getZoom) {
      this.getZoom = context.getZoom;
    }
  }

  public override getYMapProps(): Record<string, unknown> {
    return { label: this._label };
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      label: (v) => {
        this._label = typeof v === 'string' ? v : '';
      },
    });
  }

  public override get localBoundingBox(): DOMRect {
    const s = 1 / this.getZoom();
    return new DOMRect(
      FLAG_BOX.x * s,
      FLAG_BOX.y * s,
      FLAG_BOX.width * s,
      FLAG_BOX.height * s,
    );
  }

  // Markers are UI, not content: kept out of thumbnails (PDF export already skips non-overlays).
  public override drawThumbnail(): void {}

  protected override isOverLocal(
    x: number,
    y: number,
    radius: number,
  ): boolean {
    const box = this.localBoundingBox;
    return CollisionHelper.inBox(
      { x, y },
      new DOMRect(
        box.x - radius,
        box.y - radius,
        box.width + radius * 2,
        box.height + radius * 2,
      ),
    );
  }

  protected override updateBoundingBox(): void {}

  protected override draw2D(ctx: CanvasRenderingContext2D): void {
    const s = 1 / this.getZoom();
    ctx.scale(s, s);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = FLAG_COLOR;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -24);
    ctx.stroke();
    ctx.fillStyle = FLAG_COLOR;
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(16, -18.5);
    ctx.lineTo(0, -13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
