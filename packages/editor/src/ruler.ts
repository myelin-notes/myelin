import { getCanvasPalette } from './canvas-theme';
import { RESIZE_CURSORS } from './elements/drawable-element';
import { rotateVector, type Vector2 } from './geometry';

export type RulerPart = 'body' | 'rotate' | 'start' | 'end';
/** A long edge in the ruler's own frame: -1 is the labelled top edge, 1 the bottom. */
export type RulerSide = -1 | 1;

// World units are CSS px, which PDF export prints at 96 DPI, so these are true cm on paper.
export const PX_PER_CM = 96 / 2.54;
const PX_PER_MM = PX_PER_CM / 10;
const WIDTH = 2 * PX_PER_CM;
const MIN_LENGTH = 3 * PX_PER_CM;
const ANGLE_SNAP = Math.PI / 4;
const ANGLE_SNAP_TOLERANCE = (3 * Math.PI) / 180;
// Screen px. Each is clamped to a share of the ruler so a zoomed-out ruler stays draggable.
const EDGE_INSIDE_PX = 10;
const EDGE_OUTSIDE_PX = 24;
const END_GRAB_PX = 12;
const KNOB_RADIUS_PX = 10;
const MIN_TICK_GAP_PX = 4;
const MIN_LABEL_GAP_PX = 28;

interface RulerDrag {
  part: RulerPart;
  from: Vector2;
  center: Vector2;
  angle: number;
  length: number;
}

/** The canvas's one straightedge: local view state, never written to the document. */
export class Ruler {
  private _visible = false;
  private center: Vector2 = { x: 0, y: 0 };
  private angle = 0;
  private length = MIN_LENGTH;
  private drag: RulerDrag | null = null;

  public get visible(): boolean {
    return this._visible;
  }

  /** Shows the ruler level across the middle of `view` (world space). */
  public show(view: DOMRect): void {
    this._visible = true;
    this.angle = 0;
    this.length = Math.max(
      MIN_LENGTH,
      Math.round((view.width * 0.6) / PX_PER_CM) * PX_PER_CM,
    );
    this.center = {
      x: view.x + view.width / 2,
      y: view.y + view.height / 2,
    };
  }

  public hide(): void {
    this._visible = false;
    this.drag = null;
  }

  /** The part under a world point. A null hit inside the edge band is left to the tool, to draw along. */
  public hit(point: Vector2, zoom: number): RulerPart | null {
    if (!this._visible) {
      return null;
    }
    const local = this.toLocal(point);
    const half = this.length / 2;
    if (
      Math.hypot(local.x - this.knobX, local.y) <=
      Math.min(KNOB_RADIUS_PX / zoom, WIDTH / 3)
    ) {
      return 'rotate';
    }
    if (Math.abs(local.y) > WIDTH / 2) {
      return null;
    }
    const endGrab = Math.min(END_GRAB_PX / zoom, this.length / 6);
    if (Math.abs(local.x + half) <= endGrab) {
      return 'start';
    }
    if (Math.abs(local.x - half) <= endGrab) {
      return 'end';
    }
    return Math.abs(local.x) < half &&
      Math.abs(local.y) < WIDTH / 2 - this.edgeInside(zoom)
      ? 'body'
      : null;
  }

  /** The long edge a stroke starting at `point` should follow, if any. */
  public edgeAt(point: Vector2, zoom: number): RulerSide | null {
    if (!this._visible) {
      return null;
    }
    const local = this.toLocal(point);
    const beyondEdge = Math.abs(local.y) - WIDTH / 2;
    if (
      Math.abs(local.x) > this.length / 2 ||
      beyondEdge > EDGE_OUTSIDE_PX / zoom ||
      beyondEdge < -this.edgeInside(zoom)
    ) {
      return null;
    }
    return local.y < 0 ? -1 : 1;
  }

  /** `point` slid onto the line `inset` world units outside `side`. */
  public projectToEdge(
    point: Vector2,
    side: RulerSide,
    inset: number,
  ): Vector2 {
    return this.toWorld(this.toLocal(point).x, side * (WIDTH / 2 + inset));
  }

  public cursorAt(point: Vector2, zoom: number): string | null {
    switch (this.hit(point, zoom)) {
      case 'body':
        return 'move';
      case 'rotate':
        return 'grab';
      case 'start':
      case 'end': {
        const octant = Math.round(this.angle / (Math.PI / 4));
        return RESIZE_CURSORS[((octant % 4) + 4) % 4];
      }
      case null:
        return null;
    }
  }

  public beginDrag(point: Vector2, zoom: number): void {
    const part = this.hit(point, zoom);
    this.drag = part && {
      part,
      from: point,
      center: this.center,
      angle: this.angle,
      length: this.length,
    };
  }

  public dragTo(point: Vector2): void {
    const drag = this.drag;
    if (!drag) {
      return;
    }
    if (drag.part === 'body') {
      this.center = {
        x: drag.center.x + point.x - drag.from.x,
        y: drag.center.y + point.y - drag.from.y,
      };
    } else if (drag.part === 'rotate') {
      const turn =
        Math.atan2(point.y - drag.center.y, point.x - drag.center.x) -
        Math.atan2(drag.from.y - drag.center.y, drag.from.x - drag.center.x);
      this.angle = snapAngle(drag.angle + turn);
    } else {
      // Unit vector toward the dragged end; the opposite end stays put.
      const axis = rotateVector(
        { x: drag.part === 'end' ? 1 : -1, y: 0 },
        drag.angle,
      );
      const along =
        (point.x - drag.from.x) * axis.x + (point.y - drag.from.y) * axis.y;
      this.length = Math.max(MIN_LENGTH, drag.length + along);
      const shift = (this.length - drag.length) / 2;
      this.center = {
        x: drag.center.x + axis.x * shift,
        y: drag.center.y + axis.y * shift,
      };
    }
  }

  public endDrag(): void {
    this.drag = null;
  }

  /** Draws into a context already transformed to world space. */
  public draw(ctx: CanvasRenderingContext2D, zoom: number): void {
    if (!this._visible) {
      return;
    }
    const palette = getCanvasPalette();
    const half = this.length / 2;
    const hw = WIDTH / 2;
    ctx.save();
    ctx.translate(this.center.x, this.center.y);
    ctx.rotate(this.angle);
    ctx.lineWidth = 1 / zoom;

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = palette.surface;
    ctx.fillRect(-half, -hw, this.length, WIDTH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.border;
    ctx.strokeRect(-half, -hw, this.length, WIDTH);

    const mmScreen = PX_PER_MM * zoom;
    const tickStep =
      mmScreen >= MIN_TICK_GAP_PX
        ? 1
        : mmScreen * 5 >= MIN_TICK_GAP_PX
          ? 5
          : 10;
    ctx.strokeStyle = palette.textMuted;
    ctx.beginPath();
    for (let mm = 0; mm * PX_PER_MM <= this.length; mm += tickStep) {
      const x = -half + mm * PX_PER_MM;
      const tick = WIDTH * (mm % 10 === 0 ? 0.25 : mm % 5 === 0 ? 0.16 : 0.1);
      ctx.moveTo(x, -hw);
      ctx.lineTo(x, -hw + tick);
      ctx.moveTo(x, hw);
      ctx.lineTo(x, hw - tick);
    }
    // End grips, in the band between the two tick rows.
    const grip = Math.min(3 / zoom, this.length / 40);
    for (const end of [-1, 1]) {
      for (const inset of [grip, grip * 2]) {
        const x = end * (half - inset);
        ctx.moveTo(x, -hw * 0.3);
        ctx.lineTo(x, hw * 0.3);
      }
    }
    ctx.stroke();

    ctx.fillStyle = palette.textMuted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${Math.min(11 / zoom, WIDTH * 0.2)}px sans-serif`;
    const cmScreen = PX_PER_CM * zoom;
    const labelStep =
      cmScreen >= MIN_LABEL_GAP_PX
        ? 1
        : cmScreen * 5 >= MIN_LABEL_GAP_PX
          ? 5
          : 10;
    for (let cm = 0; cm * PX_PER_CM <= this.length; cm += labelStep) {
      ctx.fillText(String(cm), -half + cm * PX_PER_CM, -hw + WIDTH * 0.28);
    }

    // The ruler is symmetric end to end for drawing, so 0° and 180° read the same.
    const degrees =
      ((Math.round((this.angle * 180) / Math.PI) % 180) + 180) % 180;
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.min(12 / zoom, WIDTH * 0.22)}px sans-serif`;
    ctx.fillText(`${degrees}°`, 0, hw * 0.35);

    const knobR = Math.min(KNOB_RADIUS_PX / zoom, WIDTH / 3);
    ctx.fillStyle = palette.surface;
    ctx.strokeStyle = palette.textMuted;
    ctx.beginPath();
    ctx.arc(this.knobX, 0, knobR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.textMuted;
    ctx.beginPath();
    ctx.arc(this.knobX, 0, knobR * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private get knobX(): number {
    return this.length / 2 - WIDTH / 2;
  }

  private edgeInside(zoom: number): number {
    return Math.min(EDGE_INSIDE_PX / zoom, WIDTH / 4);
  }

  private toLocal(point: Vector2): Vector2 {
    return rotateVector(
      { x: point.x - this.center.x, y: point.y - this.center.y },
      -this.angle,
    );
  }

  private toWorld(x: number, y: number): Vector2 {
    const p = rotateVector({ x, y }, this.angle);
    return { x: p.x + this.center.x, y: p.y + this.center.y };
  }
}

function snapAngle(angle: number): number {
  const nearest = Math.round(angle / ANGLE_SNAP) * ANGLE_SNAP;
  return Math.abs(angle - nearest) <= ANGLE_SNAP_TOLERANCE ? nearest : angle;
}
