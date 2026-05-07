import { PenTool as PenIcon } from 'lucide-react';
import type { MessageGetter } from '@/lib/i18n';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import { StrokeElement } from '../elements/stroke-element';
import type { ITool, SvgIcon, ToolId, ToolOption } from './tool';

export const PEN_COLORS = [
  '#191c1e', // black
  '#64748b', // slate
  '#ef4444', // red
  '#f59e0b', // orange
  '#eab308', // yellow
  '#059669', // green
  '#3b82f6', // blue
  '#8b5cf6', // purple
];

export class PenTool implements ITool {
  public constructor(protected readonly getStrings: MessageGetter) {}

  protected currentStroke: StrokeElement | null = null;
  protected color: string = '#191c1e';
  protected size: number = 8;

  get id(): ToolId {
    return 'pen';
  }

  public start(canvas: DrawableCanvas, _event: PointerEvent): void {
    this.currentStroke = canvas.addElement(
      (uuid) =>
        new StrokeElement(uuid, [], false, {
          color: this.color,
          size: this.size,
        }),
    );
  }

  public update(
    _canvas: DrawableCanvas,
    event: PointerEvent,
    position: Vector2,
  ): void {
    this.currentStroke?.addPoint(position.x, position.y, event.pressure);
  }

  public finish(canvas: DrawableCanvas, _event: PointerEvent): void {
    this.interrupt(canvas);
  }

  public interrupt(canvas: DrawableCanvas): void {
    this.currentStroke?.updateBounds();
    this.currentStroke = null;
    canvas.updateBounding();
  }

  public drawCursor(_ctx: CanvasRenderingContext2D, _position: Vector2): void {}

  get icon(): SvgIcon {
    return PenIcon;
  }

  get label(): string {
    return this.getStrings().canvas.tools.pen;
  }

  getOptions(): ToolOption[] {
    const strings = this.getStrings();
    return [
      {
        type: 'color',
        key: 'color',
        label: strings.canvas.toolOptions.color,
        value: this.color,
        palette: PEN_COLORS,
        set: (color) => {
          this.color = color;
        },
      },
      {
        type: 'size',
        key: 'size',
        label: strings.canvas.toolOptions.stroke,
        value: this.size,
        min: 1,
        max: 40,
        step: 1,
        set: (size) => {
          this.size = size;
        },
      },
    ];
  }
}
