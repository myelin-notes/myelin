import { Eraser as EraserIcon } from 'lucide-react';
import { getCanvasPalette, withCanvasAlpha } from '../canvas-theme';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import { ElementType } from '../elements/element-type';
import type { MessageGetter } from '../i18n';
import type { ITool, SvgIcon, ToolId, ToolOption } from './tool';

export class EraserTool implements ITool {
  private radius: number;

  public constructor(private readonly getStrings: MessageGetter) {
    this.radius = 20;
  }

  get id(): ToolId {
    return 'eraser';
  }

  public start(_canvas: DrawableCanvas, _event: PointerEvent): void {}

  public finish(_canvas: DrawableCanvas, _event: PointerEvent): void {}

  public interrupt(_canvas: DrawableCanvas): void {}

  public update(
    canvas: DrawableCanvas,
    _event: PointerEvent,
    position: Vector2,
  ): void {
    canvas.elements
      .filter(
        (e) =>
          e.type === ElementType.STROKE &&
          e.isOver(position.x, position.y, this.radius, canvas.ctx),
      )
      .forEach((e) => {
        canvas.removeElement(e);
      });
  }

  public drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void {
    const palette = getCanvasPalette();
    ctx.fillStyle = palette.selectionFill;
    ctx.beginPath();
    ctx.arc(position.x, position.y, this.radius, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = withCanvasAlpha(palette.selectionStroke, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(position.x, position.y, this.radius, 0, 2 * Math.PI);
    ctx.stroke();
  }

  get icon(): SvgIcon {
    return EraserIcon;
  }

  get label(): string {
    return this.getStrings().canvas.tools.eraser;
  }

  getOptions(): ToolOption[] {
    return [
      {
        type: 'size',
        key: 'size',
        label: this.getStrings().canvas.toolOptions.size,
        value: this.radius,
        min: 5,
        max: 60,
        step: 1,
        set: (size) => {
          this.radius = size;
        },
      },
    ];
  }
}
