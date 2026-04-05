import { Selection } from 'prosemirror-state';
import type {
  BinaryReader,
  BinaryWriter,
} from '../../../lib/utils/binary-helper';
import type { UndoCommand } from '../../../lib/utils/undo-redo';
import { EditPageFrameCommand } from '../commands/edit-page-frame';
import { PageFrameEditorState } from '../page-frame/pm/pm-editor-state';
import { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';

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
  private _oldDocJSON: Record<string, unknown> = {};

  public readonly pmEditor = new PageFrameEditorState();

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

  public override enterEditMode(): void {
    this._editing = true;
    this._oldDocJSON = this.pmEditor.toJSON();
    this.pmEditor.setEditable(true);

    // Focus and place cursor at end
    const view = this.pmEditor.view;
    if (view) {
      view.focus();
      const { doc } = view.state;
      const endPos = doc.content.size - 1;
      const tr = view.state.tr.setSelection(
        Selection.near(doc.resolve(endPos)),
      );
      view.dispatch(tr);
    }
  }

  public override exitEditMode(): UndoCommand | null {
    this._editing = false;
    this.pmEditor.setEditable(false);

    const newDocJSON = this.pmEditor.toJSON();
    const changed =
      JSON.stringify(newDocJSON) !== JSON.stringify(this._oldDocJSON);
    if (changed) {
      return new EditPageFrameCommand(this, this._oldDocJSON, newDocJSON);
    }
    return null;
  }

  protected draw2D(_ctx: CanvasRenderingContext2D, _deltaTime: number): void {}

  /** Draw page chrome (white card + shadow). Called on the background canvas. */
  public drawChrome(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.offset.x, this.offset.y);
    for (let p = 0; p < this._numPages; p++) {
      const y = p * (this._pageHeight + PAGE_GAP);
      ctx.save();
      ctx.shadowColor = 'rgba(25, 28, 30, 0.08)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(
        0,
        y,
        this._pageWidth,
        this._pageHeight,
        PAGE_CORNER_RADIUS,
      );
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = 'rgba(195, 199, 202, 0.2)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.roundRect(
        0,
        y,
        this._pageWidth,
        this._pageHeight,
        PAGE_CORNER_RADIUS,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  public save(writer: BinaryWriter): void {
    super.save(writer);
    writer.writeF32(this._pageWidth);
    writer.writeF32(this._pageHeight);
    writer.writeString(JSON.stringify(this.pmEditor.toJSON()));
  }

  public load(reader: BinaryReader): void {
    super.load(reader);
    this._pageWidth = reader.readF32();
    this._pageHeight = reader.readF32();
    const jsonStr = reader.readString();
    this.pmEditor.setDocJSON(JSON.parse(jsonStr) as Record<string, unknown>);
  }
}
