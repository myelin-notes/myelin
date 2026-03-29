import { Eraser as EraserIcon } from 'lucide-react';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type { ITool, SvgIcon, ToolOption } from './tool';

export class EraserTool implements ITool {
  private radius: number;

  public constructor() {
    this.radius = 20;
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
      .filter((e) => e.isOver(position.x, position.y, this.radius, canvas.ctx))
      .forEach((e) => {
        canvas.removeElement(e);
      });
  }

  public drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void {
    ctx.fillStyle = 'rgba(208, 225, 251, 0.15)';
    ctx.beginPath();
    ctx.arc(position.x, position.y, this.radius, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = 'rgba(47, 62, 70, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(position.x, position.y, this.radius, 0, 2 * Math.PI);
    ctx.stroke();
  }

  get icon(): SvgIcon {
    return EraserIcon;
  }

  get label(): string {
    return 'Eraser';
  }

  getOptions(): ToolOption[] {
    return [
      {
        type: 'size',
        key: 'size',
        label: 'Size',
        value: this.radius,
        min: 5,
        max: 60,
        step: 1,
      },
    ];
  }

  setOption(key: string, value: unknown): void {
    if (key === 'size' && typeof value === 'number') {
      this.radius = value;
    }
  }
}
