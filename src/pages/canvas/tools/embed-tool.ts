import { ImagePlus as ImagePlusIcon } from 'lucide-react';
import type { MessageGetter } from '@/lib/i18n';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type { ITool, SvgIcon, ToolId } from './tool';

export class EmbedTool implements ITool {
  public constructor(private readonly getStrings: MessageGetter) {}

  get id(): ToolId {
    return 'embed';
  }

  start(_canvas: DrawableCanvas, _event: PointerEvent): void {}

  update(
    _canvas: DrawableCanvas,
    _event: PointerEvent,
    _position: Vector2,
  ): void {}

  finish(_canvas: DrawableCanvas, _event: PointerEvent): void {}

  interrupt(_canvas: DrawableCanvas): void {}

  drawCursor(_ctx: CanvasRenderingContext2D, _position: Vector2): void {}

  get icon(): SvgIcon {
    return ImagePlusIcon;
  }

  get label(): string {
    return this.getStrings().canvas.tools.embed;
  }
}
