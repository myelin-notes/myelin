import type * as Y from 'yjs';
import { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';

export class ImageElement extends DrawableElement {
  private box: DOMRect = new DOMRect(0, 0, 0, 0);
  private _bitmap: ImageBitmap | null = null;
  private _naturalWidth: number = 0;
  private _naturalHeight: number = 0;

  public constructor(index: number) {
    super(index, ElementType.IMAGE);
  }

  public override getYMapProps(): Record<string, unknown> {
    return {
      naturalWidth: this._naturalWidth,
      naturalHeight: this._naturalHeight,
    };
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      naturalWidth: (v) => {
        this._naturalWidth = v as number;
      },
      naturalHeight: (v) => {
        this._naturalHeight = v as number;
      },
      imageData: (v) => {
        const blob = new Blob([(v as Uint8Array).slice()]);
        createImageBitmap(blob).then((bmp) => {
          this._bitmap = bmp;
        });
      },
    });
    this.updateBox();
  }

  public get naturalWidth(): number {
    return this._naturalWidth;
  }
  public get naturalHeight(): number {
    return this._naturalHeight;
  }

  public async setImageData(data: ArrayBuffer) {
    const blob = new Blob([data]);
    this._bitmap = await createImageBitmap(blob);
    this._naturalWidth = this._bitmap.width;
    this._naturalHeight = this._bitmap.height;
    this.updateBox();
    this.syncToYMap({
      imageData: new Uint8Array(data),
      naturalWidth: this._naturalWidth,
      naturalHeight: this._naturalHeight,
    });
  }

  private updateBox() {
    this.box = new DOMRect(0, 0, this._naturalWidth, this._naturalHeight);
  }

  protected draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
    if (!this._bitmap) {
      return;
    }
    ctx.drawImage(this._bitmap, 0, 0);
  }

  protected isOverLocal(
    x: number,
    y: number,
    _radius: number,
    _ctx: CanvasRenderingContext2D,
  ): boolean {
    const b = this.box;
    return x >= b.x && x <= b.right && y >= b.y && y <= b.bottom;
  }

  public get localBoundingBox(): DOMRect {
    return this.box;
  }

  protected updateBoundingBox(): void {
    this.updateBox();
  }
}
