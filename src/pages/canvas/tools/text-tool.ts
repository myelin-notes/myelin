import { Type as TypeIcon } from 'lucide-react';
import type { MessageGetter } from '@/lib/i18n';
import { CollisionHelper } from '../../../lib/utils/collision-helper';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import { TextElement } from '../elements/text-element';
import type { FontEntry, ITool, SvgIcon, ToolId, ToolOption } from './tool';

const TEXT_COLORS = [
  '#191c1e',
  '#64748b',
  '#1c2738',
  '#3b82f6',
  '#ef4444',
  '#059669',
  '#f59e0b',
  '#8b5cf6',
];

const TEXT_FONTS: FontEntry[] = [
  { family: 'Inter', category: 'sans-serif' },
  { family: 'Roboto', category: 'sans-serif' },
  { family: 'Open Sans', category: 'sans-serif' },
  { family: 'Lato', category: 'sans-serif' },
  { family: 'Poppins', category: 'sans-serif' },
  { family: 'Newsreader', category: 'serif' },
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Merriweather', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'JetBrains Mono', category: 'monospace' },
  { family: 'Fira Code', category: 'monospace' },
  { family: 'Caveat', category: 'cursive' },
  { family: 'Kalam', category: 'cursive' },
];

const DEFAULT_BOX_WIDTH = 200;
const DEFAULT_BOX_HEIGHT = 80;
const CLICK_THRESHOLD = 5;

export class TextTool implements ITool {
  public constructor(private readonly getStrings: MessageGetter) {}

  private color: string = '#191c1e';
  private fontSize: number = 24;
  private fontFamily: string = 'Inter';

  private dragStart: Vector2 | null = null;
  private dragCurrent: Vector2 | null = null;

  get id(): ToolId {
    return 'text';
  }

  start(canvas: DrawableCanvas, event: PointerEvent): void {
    this.dragStart = canvas.viewport.getPoint(event);
    this.dragCurrent = this.dragStart;
  }

  update(
    _canvas: DrawableCanvas,
    _event: PointerEvent,
    position: Vector2,
  ): void {
    if (this.dragStart) {
      this.dragCurrent = position;
    }
  }

  finish(canvas: DrawableCanvas, event: PointerEvent): void {
    const endPos = canvas.viewport.getPoint(event);

    if (!this.dragStart) {
      this.dragStart = null;
      this.dragCurrent = null;
      return;
    }

    const dx = Math.abs(endPos.x - this.dragStart.x);
    const dy = Math.abs(endPos.y - this.dragStart.y);
    const isClick = dx < CLICK_THRESHOLD && dy < CLICK_THRESHOLD;

    if (isClick) {
      // Check if clicking on existing text element
      for (let i = canvas.elements.length - 1; i >= 0; i--) {
        const e = canvas.elements[i];
        if (
          e instanceof TextElement &&
          CollisionHelper.inBox(endPos, e.boundingBox)
        ) {
          this.editExisting(canvas, event, e);
          this.dragStart = null;
          this.dragCurrent = null;
          return;
        }
      }
      // Click-to-create with default size
      this.createNew(
        canvas,
        this.dragStart,
        DEFAULT_BOX_WIDTH,
        DEFAULT_BOX_HEIGHT,
      );
    } else {
      // Drag-to-create with custom size
      const x = Math.min(this.dragStart.x, endPos.x);
      const y = Math.min(this.dragStart.y, endPos.y);
      const w = Math.max(dx, 40);
      const h = Math.max(dy, this.fontSize * 1.3);
      this.createNew(canvas, { x, y }, w, h);
    }

    this.dragStart = null;
    this.dragCurrent = null;
  }

  private editExisting(
    canvas: DrawableCanvas,
    event: Event,
    element: TextElement,
  ) {
    element.select();
    canvas.enterElementEdit(element, event);
  }

  private createNew(
    canvas: DrawableCanvas,
    worldPos: Vector2,
    boxWidth: number,
    boxHeight: number,
  ) {
    const el = canvas.addElement((i) => {
      const te = new TextElement(
        i,
        '',
        {
          color: this.color,
          fontSize: this.fontSize,
          fontFamily: this.fontFamily,
        },
        boxWidth,
        boxHeight,
      );
      te.setOffset(worldPos.x, worldPos.y);
      return te;
    });
    el.select();
    canvas.enterElementEdit(el);
  }

  interrupt(_canvas: DrawableCanvas): void {
    this.dragStart = null;
    this.dragCurrent = null;
  }

  drawCursor(ctx: CanvasRenderingContext2D, _position: Vector2): void {
    if (!(this.dragStart && this.dragCurrent)) {
      return;
    }

    const x = Math.min(this.dragStart.x, this.dragCurrent.x);
    const y = Math.min(this.dragStart.y, this.dragCurrent.y);
    const w = Math.abs(this.dragCurrent.x - this.dragStart.x);
    const h = Math.abs(this.dragCurrent.y - this.dragStart.y);

    if (w < CLICK_THRESHOLD && h < CLICK_THRESHOLD) {
      return;
    }

    ctx.fillStyle = 'rgba(208, 225, 251, 0.15)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();

    ctx.strokeStyle = '#2f3e46';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  get icon(): SvgIcon {
    return TypeIcon;
  }

  get label(): string {
    return this.getStrings().canvas.tools.text;
  }

  getOptions(): ToolOption[] {
    const strings = this.getStrings().canvas;
    return [
      {
        type: 'font',
        key: 'fontFamily',
        label: strings.toolOptions.font,
        value: this.fontFamily,
        fonts: TEXT_FONTS,
        set: (fontFamily) => {
          this.fontFamily = fontFamily;
        },
      },
      {
        type: 'color',
        key: 'color',
        label: strings.toolOptions.color,
        value: this.color,
        palette: TEXT_COLORS,
        set: (color) => {
          this.color = color;
        },
      },
      {
        type: 'size',
        key: 'fontSize',
        label: strings.toolOptions.fontSize,
        value: this.fontSize,
        min: 12,
        max: 72,
        step: 2,
        set: (fontSize) => {
          this.fontSize = fontSize;
        },
      },
    ];
  }

  applyOptionToSelection(
    canvas: DrawableCanvas,
    key: string,
    value: unknown,
  ): void {
    if (key !== 'color' && key !== 'fontSize' && key !== 'fontFamily') {
      return;
    }
    let touched = false;
    for (const el of canvas.elements) {
      if (el instanceof TextElement && el.isSelected) {
        el.setStyle({ [key]: value } as Parameters<TextElement['setStyle']>[0]);
        touched = true;
      }
    }
    if (touched) {
      canvas.updateBounding();
    }
  }
}
