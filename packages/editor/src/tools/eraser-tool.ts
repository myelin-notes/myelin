import {
  Eraser as EraserIcon,
  SplinePointer as PreciseEraserIcon,
} from 'lucide-react';
import { getCanvasPalette, withCanvasAlpha } from '../canvas-theme';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import { ElementType } from '../elements/element-type';
import { StrokeElement } from '../elements/stroke-element';
import type { MessageGetter } from '../i18n';
import type { ITool, SvgIcon, ToolId, ToolOption } from './tool';

type EraserStyle = 'stroke' | 'precise';

export class EraserTool implements ITool {
  private radius = 20;
  private eraserStyle: EraserStyle = 'stroke';

  public constructor(private readonly getStrings: MessageGetter) {}

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
    for (const element of [...canvas.elements]) {
      if (
        element.type !== ElementType.STROKE &&
        element.type !== ElementType.SHAPE
      ) {
        continue;
      }
      if (this.eraserStyle === 'precise' && element instanceof StrokeElement) {
        this.eraseStrokePoints(canvas, element, position);
        continue;
      }
      if (element.isOver(position.x, position.y, this.radius, canvas.ctx)) {
        canvas.removeElement(element);
      }
    }
  }

  private eraseStrokePoints(
    canvas: DrawableCanvas,
    stroke: StrokeElement,
    position: Vector2,
  ): void {
    const runs = stroke.getPointRunsOutsideCircle(
      position.x,
      position.y,
      this.radius,
    );
    if (!runs) {
      return;
    }
    if (runs.length === 0) {
      canvas.removeElement(stroke);
      return;
    }

    const originalIndex = canvas.elements.indexOf(stroke);
    const style = { ...stroke.strokeStyle };
    const hasPressure = stroke.pressureEnabled;
    const offset = { ...stroke.offset };
    const scale = { ...stroke.scale };

    canvas.transact(() => {
      stroke.replacePoints(runs[0]);
      for (let i = 1; i < runs.length; i++) {
        const fragment = canvas.addElement((uuid) => {
          const next = new StrokeElement(uuid, runs[i], hasPressure, {
            ...style,
          });
          next.updateBounds();
          return next;
        }, originalIndex + i);
        fragment.setOffset(offset.x, offset.y);
        fragment.setScale(scale.x, scale.y);
      }
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
    const strings = this.getStrings().canvas;
    return [
      {
        type: 'choice',
        key: 'eraserStyle',
        label: strings.toolOptions.mode,
        value: this.eraserStyle,
        set: (eraserStyle) => {
          this.eraserStyle = eraserStyle as EraserStyle;
        },
        choices: [
          {
            value: 'stroke',
            label: strings.toolOptions.stroke,
            icon: EraserIcon,
          },
          {
            value: 'precise',
            label: strings.toolOptions.precise,
            icon: PreciseEraserIcon,
          },
        ],
      },
      {
        type: 'size',
        key: 'size',
        label: strings.toolOptions.size,
        value: this.radius,
        min: 1,
        max: 60,
        step: 1,
        set: (size) => {
          this.radius = size;
        },
      },
    ];
  }
}
