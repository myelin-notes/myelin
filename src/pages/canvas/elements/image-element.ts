import { Crop as CropIcon } from 'lucide-react';
import type * as Y from 'yjs';
import type { Messages } from '@/lib/i18n/messages';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type { YDocManager } from '../ydoc-manager';
import {
  DrawableElement,
  type ResizeHandle,
  type SelectionToolbarItem,
} from './drawable-element';
import { ElementType } from './element-type';

const MIN_CROP_NATURAL = 1;
const CROP_DIM_ALPHA = 0.4;

interface CropResizeBaseline {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

interface CropEntrySnapshot {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  offsetX: number;
  offsetY: number;
}

export class ImageElement extends DrawableElement {
  private box: DOMRect = new DOMRect(0, 0, 0, 0);
  private _bitmap: ImageBitmap | null = null;
  private _naturalWidth: number = 0;
  private _naturalHeight: number = 0;
  private _cropX: number = 0;
  private _cropY: number = 0;
  private _cropW: number = 0;
  private _cropH: number = 0;
  private _cropMode: boolean = false;
  private _cropKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _cropResizeBaseline: CropResizeBaseline | null = null;
  private _cropEntrySnapshot: CropEntrySnapshot | null = null;
  private _ydoc: YDocManager | null = null;
  private _editingCropCanvas: DrawableCanvas | null = null;

  public constructor(uuid: string) {
    super(uuid, ElementType.IMAGE);
  }

  public override getYMapProps(): Record<string, unknown> {
    return {
      naturalWidth: this._naturalWidth,
      naturalHeight: this._naturalHeight,
      cropX: this._cropX,
      cropY: this._cropY,
      cropW: this._cropW,
      cropH: this._cropH,
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
      cropX: (v) => {
        this._cropX = v as number;
      },
      cropY: (v) => {
        this._cropY = v as number;
      },
      cropW: (v) => {
        this._cropW = v as number;
      },
      cropH: (v) => {
        this._cropH = v as number;
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
  public get cropMode(): boolean {
    return this._cropMode;
  }

  public override get editable(): boolean {
    return this._bitmap !== null && this._naturalWidth !== 0;
  }

  public async setImageData(data: ArrayBuffer) {
    const blob = new Blob([data]);
    this._bitmap = await createImageBitmap(blob);
    this._naturalWidth = this._bitmap.width;
    this._naturalHeight = this._bitmap.height;
    this._cropX = 0;
    this._cropY = 0;
    this._cropW = this._naturalWidth;
    this._cropH = this._naturalHeight;
    this.updateBox();
    this.syncToYMap({
      imageData: new Uint8Array(data),
      naturalWidth: this._naturalWidth,
      naturalHeight: this._naturalHeight,
      cropX: 0,
      cropY: 0,
      cropW: this._naturalWidth,
      cropH: this._naturalHeight,
    });
  }

  private updateBox() {
    this.box = new DOMRect(0, 0, this._cropW, this._cropH);
  }

  protected draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
    if (!this._bitmap) {
      return;
    }
    if (this._cropMode) {
      ctx.save();
      ctx.globalAlpha = CROP_DIM_ALPHA;
      ctx.drawImage(this._bitmap, -this._cropX, -this._cropY);
      ctx.restore();
    }
    ctx.drawImage(
      this._bitmap,
      this._cropX,
      this._cropY,
      this._cropW,
      this._cropH,
      0,
      0,
      this._cropW,
      this._cropH,
    );
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

  public override bindSharedYState(ydoc: YDocManager): void {
    this._ydoc = ydoc;
  }

  public enterCropMode(): void {
    if (this._cropMode || !this._bitmap || this._naturalWidth === 0) {
      return;
    }
    this._ydoc?.undoManager.stopCapturing();
    this._cropMode = true;
    this._cropEntrySnapshot = {
      cropX: this._cropX,
      cropY: this._cropY,
      cropW: this._cropW,
      cropH: this._cropH,
      offsetX: this.offset.x,
      offsetY: this.offset.y,
    };
    this._cropKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelCropMode();
      }
    };
    document.addEventListener('keydown', this._cropKeyHandler);
    this.onTransformChanged?.();
  }

  public exitCropMode(): void {
    if (!this._cropMode) {
      return;
    }
    this._cropMode = false;
    if (this._cropKeyHandler) {
      document.removeEventListener('keydown', this._cropKeyHandler);
      this._cropKeyHandler = null;
    }
    this._cropResizeBaseline = null;
    this._cropEntrySnapshot = null;
    this._ydoc?.undoManager.stopCapturing();
    this.onTransformChanged?.();
  }

  public cancelCropMode(): void {
    if (!this._cropMode) {
      return;
    }
    const snap = this._cropEntrySnapshot;
    if (snap) {
      this._cropX = snap.cropX;
      this._cropY = snap.cropY;
      this._cropW = snap.cropW;
      this._cropH = snap.cropH;
      this.updateBox();
      this.syncToYMap({
        cropX: snap.cropX,
        cropY: snap.cropY,
        cropW: snap.cropW,
        cropH: snap.cropH,
      });
      this.setOffset(snap.offsetX, snap.offsetY);
    }
    this.exitCropMode();
  }

  public toggleCropMode(): void {
    if (this._cropMode) {
      // Toolbar "Apply Crop" is the only commit path. Commit first, then
      // tear down edit mode — the subsequent exitEditMode will see
      // _cropMode === false and its cancel is a no-op.
      this.exitCropMode();
      this._editingCropCanvas?.exitElementEdit();
    } else {
      this.enterCropMode();
    }
  }

  public override enterEditMode(canvas: DrawableCanvas): HTMLElement | null {
    this._editingCropCanvas = canvas;
    this.enterCropMode();
    return null;
  }

  public override exitEditMode(): void {
    // Commits the crop. Escape cancels via the element's own keydown handler
    // registered in enterCropMode, which clears _cropMode before this runs,
    // so the exitCropMode below becomes a no-op on Escape.
    this.exitCropMode();
    this._editingCropCanvas = null;
  }

  public override getSelectionToolbarItems(
    strings: Messages,
  ): SelectionToolbarItem[] {
    if (!this._bitmap || this._naturalWidth === 0) {
      return [];
    }
    return [
      {
        id: 'crop',
        label: this._cropMode
          ? strings.canvas.selectionToolbar.applyCrop
          : strings.canvas.selectionToolbar.crop,
        icon: CropIcon,
        active: this._cropMode,
        onClick: () => this.toggleCropMode(),
      },
    ];
  }

  public override unselect(): void {
    this.cancelCropMode();
    super.unselect();
  }

  public override beginResize(): void {
    if (this._cropMode) {
      this._cropResizeBaseline = {
        cropX: this._cropX,
        cropY: this._cropY,
        cropW: this._cropW,
        cropH: this._cropH,
      };
    }
  }

  public override endResize(): void {
    this._cropResizeBaseline = null;
  }

  public override applyResize(opts: {
    handle: ResizeHandle;
    originalScale: Vector2;
    originalOffset: Vector2;
    ratioX: number;
    ratioY: number;
    anchorWorld: Vector2;
  }): void {
    if (!this._cropMode) {
      super.applyResize(opts);
      return;
    }
    const baseline = this._cropResizeBaseline;
    if (!baseline) {
      return;
    }
    const { handle: h, originalScale, originalOffset, anchorWorld } = opts;
    const sx = originalScale.x;
    const sy = originalScale.y;
    const { cropX: bcx, cropY: bcy, cropW: bcw, cropH: bch } = baseline;

    // Anchor in natural-image coordinates stays fixed across the drag.
    const anchorNaturalX = bcx + bcw * h.anchorFx;
    const anchorNaturalY = bcy + bch * h.anchorFy;

    let newCw = bcw;
    let newCh = bch;
    if (h.scaleX) {
      const newWorldW = Math.abs(opts.ratioX) * Math.abs(bcw * sx);
      const maxCw =
        h.anchorFx === 1 ? anchorNaturalX : this._naturalWidth - anchorNaturalX;
      if (maxCw >= MIN_CROP_NATURAL) {
        newCw = Math.min(
          maxCw,
          Math.max(MIN_CROP_NATURAL, newWorldW / Math.abs(sx)),
        );
      }
    }
    if (h.scaleY) {
      const newWorldH = Math.abs(opts.ratioY) * Math.abs(bch * sy);
      const maxCh =
        h.anchorFy === 1
          ? anchorNaturalY
          : this._naturalHeight - anchorNaturalY;
      if (maxCh >= MIN_CROP_NATURAL) {
        newCh = Math.min(
          maxCh,
          Math.max(MIN_CROP_NATURAL, newWorldH / Math.abs(sy)),
        );
      }
    }

    const newCx =
      h.anchorFx === 1
        ? anchorNaturalX - newCw
        : h.anchorFx === 0
          ? anchorNaturalX
          : bcx;
    const newCy =
      h.anchorFy === 1
        ? anchorNaturalY - newCh
        : h.anchorFy === 0
          ? anchorNaturalY
          : bcy;

    const newOffsetX = h.scaleX
      ? anchorWorld.x - (anchorNaturalX - newCx) * sx
      : originalOffset.x;
    const newOffsetY = h.scaleY
      ? anchorWorld.y - (anchorNaturalY - newCy) * sy
      : originalOffset.y;

    this._cropX = newCx;
    this._cropY = newCy;
    this._cropW = newCw;
    this._cropH = newCh;
    this.updateBox();
    this.syncToYMap({
      cropX: newCx,
      cropY: newCy,
      cropW: newCw,
      cropH: newCh,
    });
    this.setOffset(newOffsetX, newOffsetY);
  }
}
