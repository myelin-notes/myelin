import { FilePlus2 as FilePlusIcon } from 'lucide-react';
import type { MessageGetter } from '@/lib/i18n';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import {
  CHROME_BOTTOM_PADDING,
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
} from '../elements/frame-chrome';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PageFrameElement,
} from '../elements/page-frame-element';
import type { ITool, SvgIcon, ToolId } from './tool';

const GHOST_FILL = 'rgba(208, 225, 251, 0.18)';
const GHOST_STROKE = '#2f3e46';
const GHOST_CORNER_RADIUS = 6;

export class FrameTool implements ITool {
  public constructor(private readonly getStrings: MessageGetter) {}

  private pressed: boolean = false;
  private hoverPosition: Vector2 | null = null;

  get id(): ToolId {
    return 'frame';
  }

  hover(_canvas: DrawableCanvas, position: Vector2): void {
    this.hoverPosition = position;
  }

  start(canvas: DrawableCanvas, event: PointerEvent): void {
    this.pressed = true;
    this.hoverPosition = canvas.viewport.getPoint(event);
  }

  update(
    _canvas: DrawableCanvas,
    _event: PointerEvent,
    position: Vector2,
  ): void {
    this.hoverPosition = position;
  }

  finish(canvas: DrawableCanvas, event: PointerEvent): void {
    if (!this.pressed) {
      return;
    }
    this.pressed = false;

    const position = canvas.viewport.getPoint(event);
    const frame = canvas.addElement((i) => new PageFrameElement(i));
    frame.setOffset(position.x, position.y);
    frame.updateBounds();
    canvas.updateBounding();

    frame.select();
  }

  interrupt(_canvas: DrawableCanvas): void {
    this.pressed = false;
    this.hoverPosition = null;
  }

  drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void {
    const origin = this.hoverPosition ?? position;

    const x = origin.x - CHROME_SIDE_PADDING;
    const y = origin.y - CHROME_HEADER_HEIGHT;
    const w = PAGE_WIDTH + CHROME_SIDE_PADDING * 2;
    const h = PAGE_HEIGHT + CHROME_HEADER_HEIGHT + CHROME_BOTTOM_PADDING;

    ctx.fillStyle = GHOST_FILL;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, GHOST_CORNER_RADIUS);
    ctx.fill();

    ctx.strokeStyle = GHOST_STROKE;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, GHOST_CORNER_RADIUS);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  get icon(): SvgIcon {
    return FilePlusIcon;
  }

  get label(): string {
    return this.getStrings().canvas.tools.frame;
  }
}
