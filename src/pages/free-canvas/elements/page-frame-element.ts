import type {
  BinaryReader,
  BinaryWriter,
} from '../../../lib/utils/binary-helper';
import { BlockEditor } from './block-editor';
import type { BlockType } from './block-types/index';
import { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';

export type { EditableBlock } from './block-editor';

export const PAGE_WIDTH = 680;
export const PAGE_HEIGHT = 880;
export const PAGE_PADDING = 48;
export const PAGE_GAP = 40;
export const PAGE_CORNER_RADIUS = 3;

export class PageFrameElement extends DrawableElement {
  private _pageWidth = PAGE_WIDTH;
  private _pageHeight = PAGE_HEIGHT;
  private _editing = false;
  private _numPages = 1;

  public readonly editor = new BlockEditor();

  constructor(index: number) {
    super(index, ElementType.PAGE_FRAME);
  }

  public get editing(): boolean {
    return this._editing;
  }
  public get pageWidth(): number {
    return this._pageWidth;
  }
  public get pageHeight(): number {
    return this._pageHeight;
  }
  public get numPages(): number {
    return this._numPages;
  }
  public set numPages(n: number) {
    this._numPages = n;
  }

  public get totalHeight(): number {
    const n = this._numPages;
    return n * this._pageHeight + Math.max(0, n - 1) * PAGE_GAP;
  }

  public get localBoundingBox(): DOMRect {
    return new DOMRect(0, 0, this._pageWidth, this.totalHeight);
  }

  protected isOverLocal(
    x: number,
    y: number,
    _radius: number,
    _ctx: CanvasRenderingContext2D,
  ): boolean {
    if (x < 0 || x > this._pageWidth) {
      return false;
    }
    for (let p = 0; p < this._numPages; p++) {
      const pageTop = p * (this._pageHeight + PAGE_GAP);
      if (y >= pageTop && y <= pageTop + this._pageHeight) {
        return true;
      }
    }
    return false;
  }

  protected updateBoundingBox(): void {}

  // ── Edit lifecycle ───────────────────────────────────────────

  public enterEditMode(): void {
    this._editing = true;
  }

  public exitEditMode(): void {
    this._editing = false;
    this.editor.trimTrailingEmpty();
  }

  // ── Drawing ──────────────────────────────────────────────────
  // Page chrome + text are rendered by the DOM layer.
  // Nothing to draw on canvas.

  protected draw2D(_ctx: CanvasRenderingContext2D, _deltaTime: number): void {}

  // ── Serialization ────────────────────────────────────────────

  public save(writer: BinaryWriter): void {
    super.save(writer);
    writer.writeF32(this._pageWidth);
    writer.writeF32(this._pageHeight);
    const blocks = this.editor.blocks;
    writer.writeU32(blocks.length);
    for (const block of blocks) {
      writer.writeU8(block.type);
      writer.writeString(block.text);
    }
  }

  public load(reader: BinaryReader): void {
    super.load(reader);
    this._pageWidth = reader.readF32();
    this._pageHeight = reader.readF32();
    const count = reader.readU32();
    const blocks = [];
    for (let i = 0; i < count; i++) {
      const type = reader.readU8() as BlockType;
      const text = reader.readString();
      blocks.push({ type, text });
    }
    this.editor.setBlocks(blocks);
  }
}
