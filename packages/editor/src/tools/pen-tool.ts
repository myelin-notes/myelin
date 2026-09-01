import { PenTool as PenIcon } from 'lucide-react';
import { ADAPTIVE_INK } from '../canvas-theme';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import { ShapeElement } from '../elements/shape-element';
import { StrokeElement } from '../elements/stroke-element';
import type { MessageGetter } from '../i18n';
import { recognizeShape } from '../shape-recognizer';
import type { ITool, SvgIcon, ToolId, ToolOption } from './tool';

export const PEN_COLORS = [
  ADAPTIVE_INK, // black in light mode, near-white in dark
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
  protected color: string = ADAPTIVE_INK;
  protected size: number = 8;
  /** When false, the dwell-and-recognize shape-snapping path is skipped. */
  protected recognizeShapes: boolean = true;
  /** When false, stylus pressure is dropped and stroke width stays uniform. */
  protected usePressure: boolean = true;

  private dwellAnchor: Vector2 | null = null;
  private recognitionAttemptedForAnchor: boolean = false;
  private snapped: boolean = false;
  /** World-space handle the pen keeps steering after the snap, until release. */
  private snapDrag: SnapDrag | null = null;
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
    if (this.snapped) {
      this.dragSnappedShape(canvas, position);
      return;
    }
    this.currentStroke?.addPoint(
      position.x,
      position.y,
      this.usePressure ? event.pressure : undefined,
    );

    // Every meaningful move resets the anchor and re-arms a single timer, so recognition fires exactly
    // once per stationary hold even when pointermove stops firing for a still pen.
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
      !this.recognizeShapes ||
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
    const points = stroke.xyPoints;
    const [penX, penY] = points[points.length - 1];

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
    this.snapDrag = snapDragTarget(result.shapeType, world, {
      x: penX,
      y: penY,
    });
  }

  // Line/triangle: the vertex nearest the pen at snap time sits under the pen. Rect/ellipse: the
  // nearest bbox corner does, with the opposite corner pinned.
  private dragSnappedShape(canvas: DrawableCanvas, position: Vector2): void {
    const shape = this.currentShape;
    const drag = this.snapDrag;
    if (shape === null || drag === null) {
      return;
    }
    let world: number[];
    if (drag.kind === 'vertex') {
      drag.geom[drag.index * 2] = position.x;
      drag.geom[drag.index * 2 + 1] = position.y;
      world = drag.geom;
    } else {
      const x = Math.min(drag.pinned.x, position.x);
      const y = Math.min(drag.pinned.y, position.y);
      world = [
        x,
        y,
        Math.abs(position.x - drag.pinned.x),
        Math.abs(position.y - drag.pinned.y),
      ];
    }
    const { offsetX, offsetY } = geomOffset(shape.shapeType, world);
    canvas.transact(() => {
      shape.setGeom(shiftGeom(shape.shapeType, world, offsetX, offsetY));
      shape.setOffset(offsetX, offsetY);
    });
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
    this.reset();
  }

  public abort(canvas: DrawableCanvas): void {
    this.clearDwellTimer();
    // The element was added to the canvas on start(), so discarding the interaction means removing it —
    // leaving it would drop an ink blob where the pen came to rest.
    if (this.currentStroke) {
      canvas.removeElement(this.currentStroke);
    }
    if (this.currentShape) {
      canvas.removeElement(this.currentShape);
    }
    this.reset();
  }

  private reset(): void {
    this.currentStroke = null;
    this.currentShape = null;
    this.snapped = false;
    this.snapDrag = null;
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

type SnapDrag =
  | { kind: 'vertex'; geom: number[]; index: number }
  | { kind: 'box'; pinned: Vector2 };

function snapDragTarget(
  shapeType: ShapeElement['shapeType'],
  world: number[],
  pen: Vector2,
): SnapDrag {
  const candidates: Vector2[] =
    shapeType === 'rect' || shapeType === 'ellipse'
      ? [
          { x: world[0], y: world[1] },
          { x: world[0] + world[2], y: world[1] },
          { x: world[0] + world[2], y: world[1] + world[3] },
          { x: world[0], y: world[1] + world[3] },
        ]
      : Array.from({ length: world.length / 2 }, (_, i) => ({
          x: world[i * 2],
          y: world[i * 2 + 1],
        }));
  let index = 0;
  for (let i = 1; i < candidates.length; i++) {
    if (distance(candidates[i], pen) < distance(candidates[index], pen)) {
      index = i;
    }
  }
  if (shapeType === 'rect' || shapeType === 'ellipse') {
    return { kind: 'box', pinned: candidates[(index + 2) % 4] };
  }
  return { kind: 'vertex', geom: [...world], index };
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
