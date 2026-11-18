import {
  Eraser as EraserIcon,
  SplinePointer as PreciseEraserIcon,
} from 'lucide-react';
import { getCanvasPalette, withCanvasAlpha } from '../canvas-theme';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type {
  AnchorableElement,
  PageAnchor,
} from '../elements/anchorable-element';
import { ElementType } from '../elements/element-type';
import { ShapeElement } from '../elements/shape-element';
import { StrokeElement } from '../elements/stroke-element';
import type { MessageGetter } from '../i18n';
import type { ITool, SvgIcon, ToolId, ToolOption } from './tool';

type EraserStyle = 'stroke' | 'precise';

// Scrubbing faster than this (screen px/ms) grows the eraser; slower movement shrinks it back.
const SCRUB_SPEED = 1;
const SCRUB_GROWTH_PER_PX = 1 / 1000;
const SCRUB_MAX_BOOST = 3;
const SCRUB_SHRINK_MS = 250;

interface ScrubSample {
  x: number;
  y: number;
  time: number;
}

export class EraserTool implements ITool {
  private radius = 20;
  private eraserStyle: EraserStyle = 'stroke';
  private boost = 1;
  private lastSample: ScrubSample | null = null;

  public constructor(private readonly getStrings: MessageGetter) {}

  get id(): ToolId {
    return 'eraser';
  }

  public start(_canvas: DrawableCanvas, event: PointerEvent): void {
    this.boost = 1;
    this.lastSample = {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
    };
  }

  public finish(_canvas: DrawableCanvas, _event: PointerEvent): void {
    this.resetScrub();
  }

  public interrupt(_canvas: DrawableCanvas): void {
    this.resetScrub();
  }

  private resetScrub(): void {
    this.boost = 1;
    this.lastSample = null;
  }

  private get effectiveRadius(): number {
    return this.radius * this.boost;
  }

  // Screen px, not world, so the scrub feel doesn't change with zoom.
  private trackScrub(event: PointerEvent): void {
    const last = this.lastSample;
    if (!last) {
      return;
    }
    const sample = {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
    };
    const dt = Math.max(sample.time - last.time, 1);
    const distance = Math.hypot(sample.x - last.x, sample.y - last.y);
    this.lastSample = sample;
    if (distance / dt > SCRUB_SPEED) {
      this.boost = Math.min(
        SCRUB_MAX_BOOST,
        this.boost + distance * SCRUB_GROWTH_PER_PX,
      );
    } else {
      this.boost = 1 + (this.boost - 1) * Math.exp(-dt / SCRUB_SHRINK_MS);
    }
  }

  public update(
    canvas: DrawableCanvas,
    event: PointerEvent,
    position: Vector2,
  ): void {
    this.trackScrub(event);
    const radius = this.effectiveRadius;
    for (const element of [...canvas.elements]) {
      if (
        element.type !== ElementType.STROKE &&
        element.type !== ElementType.SHAPE
      ) {
        continue;
      }
      if (this.eraserStyle === 'precise') {
        if (element instanceof StrokeElement) {
          this.eraseStrokePoints(canvas, element, position, radius);
          continue;
        }
        if (element instanceof ShapeElement) {
          if (element.isOver(position.x, position.y, radius, canvas.ctx)) {
            this.eraseShape(canvas, element, position, radius);
          }
          continue;
        }
      }
      if (element.isOver(position.x, position.y, radius, canvas.ctx)) {
        canvas.removeElement(element);
      }
    }
  }

  private eraseShape(
    canvas: DrawableCanvas,
    shape: ShapeElement,
    position: Vector2,
    radius: number,
  ): void {
    const originalIndex = canvas.elements.indexOf(shape);
    const style = {
      ...shape.strokeStyle,
      stabilization: 0,
      simulatePressure: false,
    };
    const offset = { ...shape.offset };
    const scale = { ...shape.scale };
    const strokes: StrokeElement[] = [];
    const anchor = this.fragmentAnchor(canvas, shape);

    canvas.transact(() => {
      canvas.removeElement(shape);
      for (const points of shape.toStrokePointRuns()) {
        const stroke = canvas.addElement((uuid) => {
          const next = new StrokeElement(uuid, points, false, { ...style });
          next.updateBounds();
          return next;
        }, originalIndex + strokes.length);
        stroke.setOffset(offset.x, offset.y);
        stroke.setScale(scale.x, scale.y);
        stroke.setRotation(shape.rotation);
        stroke.setMakesSpace(shape.makesSpace);
        stroke.setPageAnchor(anchor);
        stroke.anchorOrigin = shape.anchorOrigin;
        strokes.push(stroke);
      }
      for (const stroke of strokes) {
        this.eraseStrokePoints(canvas, stroke, position, radius);
      }
    });
  }

  private eraseStrokePoints(
    canvas: DrawableCanvas,
    stroke: StrokeElement,
    position: Vector2,
    radius: number,
  ): void {
    const runs = stroke.getPointRunsOutsideCircle(
      position.x,
      position.y,
      radius,
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

    const anchor =
      runs.length > 1 ? this.fragmentAnchor(canvas, stroke) : stroke.pageAnchor;
    canvas.transact(() => {
      if (anchor !== stroke.pageAnchor) {
        stroke.setPageAnchor(anchor);
      }
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
        fragment.setRotation(stroke.rotation);
        fragment.setMakesSpace(stroke.makesSpace);
        fragment.setPageAnchor(anchor);
        fragment.anchorOrigin = stroke.anchorOrigin;
      }
    });
  }

  private fragmentAnchor(
    canvas: DrawableCanvas,
    element: AnchorableElement,
  ): PageAnchor | null {
    const anchor = element.pageAnchor;
    if (
      !anchor ||
      anchor.kind === 'pdf' ||
      !element.makesSpace ||
      anchor.sharedGap
    ) {
      return anchor;
    }
    const frame = canvas.elements.find((item) => item.uuid === anchor.frameId);
    return {
      ...anchor,
      sharedGap: {
        id: crypto.randomUUID(),
        height:
          element.boundingBox.height / (frame?.scale.y ?? 1) +
          anchor.spaceBefore,
      },
    };
  }

  public drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void {
    const palette = getCanvasPalette();
    ctx.fillStyle = palette.selectionFill;
    ctx.beginPath();
    ctx.arc(position.x, position.y, this.effectiveRadius, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = withCanvasAlpha(palette.selectionStroke, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(position.x, position.y, this.effectiveRadius, 0, 2 * Math.PI);
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
