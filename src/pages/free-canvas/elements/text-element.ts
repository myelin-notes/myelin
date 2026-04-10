import { LineBreaker } from 'css-line-break';
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

  public override enterEditMode(canvas: DrawableCanvas): HTMLElement | null {
    this._editing = true;
    this._oldText = this._text;
    this._canvas = canvas;

    const zoom = canvas.viewport.zoom;
    const screenPos = canvas.viewport.worldToScreen({
      x: this.boundingBox.x,
      y: this.boundingBox.y,
    });

    const textarea = document.createElement('textarea');
    textarea.value = this._text;
    Object.assign(textarea.style, {
      position: 'absolute',
      zIndex: '20',
      left: `${screenPos.x}px`,
      top: `${screenPos.y}px`,
      width: `${this._boxWidth * zoom}px`,
      height: `${this._boxHeight * zoom}px`,
      fontSize: `${this._style.fontSize * zoom}px`,
      lineHeight: '1.3',
      fontFamily: `"${this._style.fontFamily}", sans-serif`,
      color: 'var(--text-primary)',
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
    this.measureAndUpdate();
  }

  public setPosition(x: number, y: number) {
    this._position = { x, y };
    this.measureAndUpdate();
  }

  public setBoxSize(width: number, height: number) {
    this._boxWidth = width;
    this._boxHeight = height;
    this.measureAndUpdate();
  }

  // Absorb scale into box dimensions so font size stays constant
  public override setScale(x: number, y: number) {
    const prevSx = this._scale.x || 1;
    const prevSy = this._scale.y || 1;
    const rx = x / prevSx;
    const ry = y / prevSy;

    this._boxWidth = Math.abs(this._boxWidth * rx);
    this._boxHeight = Math.abs(this._boxHeight * ry);
    this._position.x *= rx;
    this._position.y *= ry;

    this._scale = { x: 1, y: 1 };
    this.measureAndUpdate();
  }

  protected draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
    if (!this._text || this._editing) {
      return;
    }
    const fontSize = this._style.fontSize;
    ctx.font = `${fontSize}px ${this._style.fontFamily}`;
    ctx.fillStyle = this._style.color;
    ctx.textBaseline = 'top';

    const lineHeight = fontSize * 1.3;
    const lines = wrapText(ctx, this._text, this._boxWidth);

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(
        lines[i],
        this._position.x,
        this._position.y + i * lineHeight,
      );
    }
  }

  protected isOverLocal(
    x: number,
    y: number,
    _radius: number,
    _ctx: CanvasRenderingContext2D,
  ): boolean {
    return (
      x >= this._position.x &&
      x <= this._position.x + this._boxWidth &&
      y >= this._position.y &&
      y <= this._position.y + this._boxHeight
    );
  }

  public get localBoundingBox(): DOMRect {
    return this.box;
  }

  protected updateBoundingBox(): void {
    this.measureAndUpdate();
  }

  private measureAndUpdate() {
    if (this._text) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.font = `${this._style.fontSize}px ${this._style.fontFamily}`;
      const lines = wrapText(ctx, this._text, this._boxWidth);
      const textHeight = lines.length * this._style.fontSize * 1.3;
      if (textHeight > this._boxHeight) {
        this._boxHeight = textHeight;
      }
    }
    this.box = new DOMRect(
      this._position.x,
      this._position.y,
      this._boxWidth,
      this._boxHeight,
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
    this.measureAndUpdate();
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

const SOFT_HYPHEN = '\u00AD';

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const result: string[] = [];
  const breaker = LineBreaker(text, {
    lineBreak: 'normal',
    wordBreak: 'normal',
  });

  let currentLine = '';
  let bk: IteratorResult<{ slice: () => string; required: boolean }>;
  while (!(bk = breaker.next()).done) {
    const segment = bk.value!;
    const chunk = segment.slice();

    // Handle mandatory breaks (newlines) — they come as trailing \n in the segment
    const hasMandatory = segment.required;

    // Strip trailing newline/carriage-return from the chunk itself
    const cleaned = chunk.replace(/[\r\n]+$/, '');

    // If soft-hyphen at the end, test with visible hyphen for measurement
    const endsWithShy = cleaned.endsWith(SOFT_HYPHEN);
    const displayChunk = endsWithShy ? `${cleaned.slice(0, -1)}-` : cleaned;

    const testLine = currentLine + displayChunk;

    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      // Emit current line, possibly with trailing hyphen from previous soft-hyphen
      result.push(currentLine.replace(/\u00AD$/, '-'));
      currentLine = cleaned.replace(/^\s+/, '');
    } else {
      currentLine += cleaned;
    }

    if (hasMandatory) {
      result.push(currentLine.replace(/\u00AD/g, ''));
      currentLine = '';
    }
  }

  if (currentLine) {
    result.push(currentLine.replace(/\u00AD/g, ''));
  }

  return result;
}
