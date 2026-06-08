import { PenTool as PenIcon } from 'lucide-react';
import type { MessageGetter } from '@/lib/i18n';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import { ShapeElement } from '../elements/shape-element';
import { StrokeElement } from '../elements/stroke-element';
import { recognizeShape } from '../shape-recognizer';
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

/** Pen must dwell this long (ms) before recognition is attempted. */
const DWELL_MS = 600;
/** Movement beyond this (px) re-arms the dwell timer (cancels recognition). */
const DWELL_MOVE_PX = 12;

export class PenTool implements ITool {
  public constructor(protected readonly getStrings: MessageGetter) {}

  protected currentStroke: StrokeElement | null = null;
  protected currentShape: ShapeElement | null = null;
  protected color: string = '#191c1e';
  protected size: number = 8;

  private dwellAnchor: Vector2 | null = null;
  private recognitionAttemptedForAnchor: boolean = false;
  private snapped: boolean = false;
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;

  get id(): ToolId {
    return 'pen';
  }

  public start(canvas: DrawableCanvas, _event: PointerEvent): void {
    this.clearDwellTimer();
    this.dwellAnchor = null;
    this.recognitionAttemptedForAnchor = false;
    this.snapped = false;
    this.currentShape = null;
    this.currentStroke = canvas.addElement(
      (uuid) =>
        new StrokeElement(uuid, [], false, {
          color: this.color,
          size: this.size,
        }),
    );
  }

  public update(
    canvas: DrawableCanvas,
    event: PointerEvent,
    position: Vector2,
  ): void {
    // Once snapped, the shape is committed in place; release finalizes it.
    if (this.snapped) {
      return;
    }
    this.currentStroke?.addPoint(position.x, position.y, event.pressure);

    // Standard clear-and-re-arm dwell pattern: every meaningful move resets the
    // anchor and re-arms a single timer, so recognition fires exactly once per
    // stationary hold even when pointermove stops firing for a still pen.
    if (
      this.dwellAnchor === null ||
      distance(position, this.dwellAnchor) > DWELL_MOVE_PX
    ) {
      this.clearDwellTimer();
      this.dwellAnchor = { x: position.x, y: position.y };
      this.recognitionAttemptedForAnchor = false;
      this.dwellTimer = setTimeout(() => {
        this.tryRecognize(canvas);
      }, DWELL_MS);
    }
  }

  private tryRecognize(canvas: DrawableCanvas): void {
    if (
      this.snapped ||
      this.recognitionAttemptedForAnchor ||
      this.currentStroke === null ||
      this.currentStroke.yMap === null
    ) {
      return;
    }
    this.recognitionAttemptedForAnchor = true;
    const result = recognizeShape(this.currentStroke.xyPoints);
    if (!result) {
      return;
    }

    const stroke = this.currentStroke;
    const style = { ...stroke.strokeStyle };
    const world = result.geom;
    const { offsetX, offsetY } = geomOffset(result.shapeType, world);
    const localGeom = shiftGeom(result.shapeType, world, offsetX, offsetY);

    canvas.transact(() => {
      canvas.removeElement(stroke);
      const shape = canvas.addElement(
        (uuid) => new ShapeElement(uuid, result.shapeType, localGeom, style),
      );
      shape.setOffset(offsetX, offsetY);
      this.currentShape = shape;
    });
    this.currentStroke = null;
    this.snapped = true;
  }

  public finish(canvas: DrawableCanvas, _event: PointerEvent): void {
    this.interrupt(canvas);
  }

  public interrupt(_canvas: DrawableCanvas): void {
    this.clearDwellTimer();
    if (this.currentStroke) {
      this.currentStroke.updateBounds();
      // Persist the buffered points once, now that the stroke is finished.
      this.currentStroke.commit();
    } else {
      this.currentShape?.updateBounds();
    }
    this.currentStroke = null;
    this.currentShape = null;
    this.snapped = false;
    this.dwellAnchor = null;
    this.recognitionAttemptedForAnchor = false;
  }

  private clearDwellTimer(): void {
    if (this.dwellTimer !== null) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = null;
    }
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

function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Bounding-box min of a world-space geom — becomes the element offset. */
function geomOffset(
  shapeType: ShapeElement['shapeType'],
  geom: number[],
): { offsetX: number; offsetY: number } {
  if (shapeType === 'rect' || shapeType === 'ellipse') {
    return { offsetX: geom[0], offsetY: geom[1] };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < geom.length; i += 2) {
    if (geom[i] < minX) {
      minX = geom[i];
    }
    if (geom[i + 1] < minY) {
      minY = geom[i + 1];
    }
  }
  return { offsetX: minX, offsetY: minY };
}

/** Shift world geom into a local frame anchored at (offsetX, offsetY). */
function shiftGeom(
  shapeType: ShapeElement['shapeType'],
  geom: number[],
  offsetX: number,
  offsetY: number,
): number[] {
  if (shapeType === 'rect' || shapeType === 'ellipse') {
    return [0, 0, geom[2], geom[3]];
  }
  const out = new Array<number>(geom.length);
  for (let i = 0; i + 1 < geom.length; i += 2) {
    out[i] = geom[i] - offsetX;
    out[i + 1] = geom[i + 1] - offsetY;
  }
  return out;
}
