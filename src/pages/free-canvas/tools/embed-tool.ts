import { ImagePlus as ImagePlusIcon } from 'lucide-react';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type { ITool, SvgIcon } from './tool';

export class EmbedTool implements ITool {
  start(_canvas: DrawableCanvas, _event: PointerEvent): void {}

  update(
    _canvas: DrawableCanvas,
    _event: PointerEvent,
    _position: Vector2,
  ): void {}

  finish(canvas: DrawableCanvas, event: PointerEvent): void {
    const screenPos = { x: event.pageX, y: event.pageY };
    canvas.requestFilePick(screenPos);
  }

  interrupt(_canvas: DrawableCanvas): void {}

  drawCursor(_ctx: CanvasRenderingContext2D, _position: Vector2): void {}

  get icon(): SvgIcon {
    return ImagePlusIcon;
  }

  get label(): string {
    return 'Embed';
  }
}
