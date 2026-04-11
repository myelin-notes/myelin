import {
  type LayoutLine,
  layoutWithLines,
  prepareWithSegments,
} from '@chenglou/pretext';
import type {
  BinaryReader,
  BinaryWriter,
} from '../../../lib/utils/binary-helper';
import type { UndoCommand } from '../../../lib/utils/undo-redo';
import { EditTextCommand } from '../commands/edit-text';
import type { DrawableCanvas } from '../drawable-canvas';
import { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';

export interface TextStyle {
  color: string;
  fontSize: number;
  fontFamily: string;
}

const DEFAULT_STYLE: TextStyle = {
  color: '#1a1a1a',
  fontSize: 24,
  fontFamily: 'sans-serif',
};

const DEFAULT_BOX_WIDTH = 200;
const DEFAULT_BOX_HEIGHT = 80;

export class TextElement extends DrawableElement {
  private box: DOMRect = new DOMRect(0, 0, 0, 0);
  private _text: string = '';
  private _style: TextStyle;
  private _position: { x: number; y: number } = { x: 0, y: 0 };
  private _boxWidth: number = DEFAULT_BOX_WIDTH;
  private _boxHeight: number = DEFAULT_BOX_HEIGHT;
  private _editing: boolean = false;
  private _textarea: HTMLTextAreaElement | null = null;
  private _oldText: string = '';
  private _canvas: DrawableCanvas | null = null;
  private _cachedLines: LayoutLine[] = [];
  private _cachedLineHeight: number = 0;

  public constructor(
    index: number,
    text: string = '',
    style: Partial<TextStyle> = {},
    boxWidth: number = DEFAULT_BOX_WIDTH,
    boxHeight: number = DEFAULT_BOX_HEIGHT,
  ) {
    super(index, ElementType.TEXT);
    this._text = text;
    this._style = { ...DEFAULT_STYLE, ...style };
    this._boxWidth = boxWidth;
    this._boxHeight = boxHeight;
  }

  public get text(): string {
    return this._text;
  }
  public get style(): TextStyle {
    return this._style;
  }
  public get position(): { x: number; y: number } {
    return this._position;
  }
  public get boxWidth(): number {
    return this._boxWidth;
  }
  public get boxHeight(): number {
    return this._boxHeight;
  }
  public get editing(): boolean {
    return this._editing;
  }

  public override get editable(): boolean {
    return true;
  }

  public override enterEditMode(canvas: DrawableCanvas): HTMLElement | null {
    this._editing = true;
    this._oldText = this._text;
    this._canvas = canvas;

    const zoom = canvas.viewport.zoom;
    const box = this.boundingBox;
    const screenPos = canvas.viewport.worldToScreen({
      x: box.x,
      y: box.y,
    });

    const textarea = document.createElement('textarea');
    textarea.value = this._text;
    Object.assign(textarea.style, {
      position: 'absolute',
      zIndex: '20',
      left: `${screenPos.x}px`,
      top: `${screenPos.y}px`,
      width: `${box.width * zoom}px`,
      height: `${box.height * zoom}px`,
      fontSize: `${this._style.fontSize * zoom}px`,
      lineHeight: `${this._style.fontSize * 1.3 * zoom}px`,
      fontFamily: this._style.fontFamily,
      color: this._style.color,
      caretColor: 'var(--accent-dark)',
      wordWrap: 'break-word',
      overflowWrap: 'break-word',
      whiteSpace: 'pre-wrap',
      margin: '0',
      padding: '0',
      resize: 'none',
      overflow: 'hidden',
      border: 'none',
      background: 'transparent',
      outline: 'none',
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        canvas.exitElementEdit();
      }
    });

    document.body.appendChild(textarea);
    textarea.focus();

    this._textarea = textarea;
    return textarea;
  }

  public override exitEditMode(): UndoCommand | null {
    this._editing = false;

    const textarea = this._textarea;
    const canvas = this._canvas;
    this._textarea = null;
    this._canvas = null;

    if (!textarea || !canvas) {
      return null;
    }

    const newText = textarea.value;
    textarea.remove();

    if (!newText.trim()) {
      canvas.removeElement(this);
      canvas.updateBounding();
      return null;
    }

    if (newText !== this._oldText) {
      this.setText(newText);
      this.updateBounds();
      canvas.updateBounding();
      return new EditTextCommand(this, this._oldText, newText);
    }

    return null;
  }

  public setText(text: string) {
    this._text = text;
    this.recomputeBox();
  }

  public setPosition(x: number, y: number) {
    this._position = { x, y };
    this.recomputeBox();
  }

  public setBoxSize(width: number, height: number) {
    this._boxWidth = width;
    this._boxHeight = height;
    this.recomputeBox();
  }


  protected draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
    if (!this._text || this._editing) {
      return;
    }
    const sx = this._scale.x;
    const sy = this._scale.y;

    // Counter the parent's scale so text renders at native font size
    ctx.scale(1 / sx, 1 / sy);

    const fontSize = this._style.fontSize;
    ctx.font = `${fontSize}px ${this._style.fontFamily}`;
    ctx.fillStyle = this._style.color;
    ctx.textBaseline = 'top';

    const lh = this._cachedLineHeight;
    for (let i = 0; i < this._cachedLines.length; i++) {
      ctx.fillText(
        this._cachedLines[i].text,
        this._position.x * sx,
        this._position.y * sy + i * lh,
      );
    }
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
    this.recomputeBox();
  }

  private recomputeBox() {
    const sx = Math.abs(this._scale.x) || 1;
    const sy = Math.abs(this._scale.y) || 1;
    const fontSize = this._style.fontSize;
    const lineHeight = fontSize * 1.3;
    this._cachedLineHeight = lineHeight;

    let localHeight = this._boxHeight;

    if (this._text) {
      const fontString = `${fontSize}px ${this._style.fontFamily}`;
      const effectiveWidth = this._boxWidth * sx;
      const prepared = prepareWithSegments(this._text, fontString);
      this._cachedLines = layoutWithLines(
        prepared,
        effectiveWidth,
        lineHeight,
      ).lines;

      const textHeight = this._cachedLines.length * lineHeight;

      if (sx === 1 && sy === 1) {
        // Unscaled: grow box to fit text permanently
        if (textHeight > this._boxHeight) {
          this._boxHeight = textHeight;
        }
        localHeight = this._boxHeight;
      } else {
        // Scaled: local height must produce correct world height
        // boundingBox = local * scale, so local = visualHeight / sy
        localHeight = Math.max(this._boxHeight, textHeight / sy);
      }
    } else {
      this._cachedLines = [];
    }

    this.box = new DOMRect(
      this._position.x,
      this._position.y,
      this._boxWidth,
      localHeight,
    );
  }

  public load(reader: BinaryReader): void {
    super.load(reader);
    this._text = reader.readString();
    this._style = {
      color: reader.readString(),
      fontSize: reader.readF32(),
      fontFamily: reader.readString(),
    };
    this._position = { x: reader.readF32(), y: reader.readF32() };
    this._boxWidth = reader.readF32();
    this._boxHeight = reader.readF32();
    this.recomputeBox();
  }

  public save(writer: BinaryWriter): void {
    super.save(writer);
    writer.writeString(this._text);
    writer.writeString(this._style.color);
    writer.writeF32(this._style.fontSize);
    writer.writeString(this._style.fontFamily);
    writer.writeF32(this._position.x);
    writer.writeF32(this._position.y);
    writer.writeF32(this._boxWidth);
    writer.writeF32(this._boxHeight);
  }
}
