export interface Point {
  x: number;
  y: number;
}

export interface Contour {
  points: Point[];
  closed: boolean;
}

/** Local-space curve flattening tolerance; at 5× zoom this is a quarter CSS pixel. */
const TOLERANCE = 0.05;

export class RenderPath {
  readonly contours: Contour[] = [];
  private current: Contour | null = null;

  moveTo(x: number, y: number): void {
    this.current = { points: [{ x, y }], closed: false };
    this.contours.push(this.current);
  }

  lineTo(x: number, y: number): void {
    if (!this.current) {
      this.moveTo(x, y);
    } else {
      this.current.points.push({ x, y });
    }
  }

  closePath(): void {
    if (this.current) {
      this.current.closed = true;
    }
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const start = this.lastPoint();
    this.bezierCurveTo(
      start.x + (2 / 3) * (cx - start.x),
      start.y + (2 / 3) * (cy - start.y),
      x + (2 / 3) * (cx - x),
      y + (2 / 3) * (cy - y),
      x,
      y,
    );
  }

  bezierCurveTo(
    cx1: number,
    cy1: number,
    cx2: number,
    cy2: number,
    x: number,
    y: number,
  ): void {
    const flatten = (
      a: Point,
      b: Point,
      c: Point,
      d: Point,
      depth: number,
    ): void => {
      const ux = 3 * b.x - 2 * a.x - d.x;
      const uy = 3 * b.y - 2 * a.y - d.y;
      const vx = 3 * c.x - 2 * d.x - a.x;
      const vy = 3 * c.y - 2 * d.y - a.y;
      if (
        depth >= 16 ||
        Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy) <=
          16 * TOLERANCE ** 2
      ) {
        this.lineTo(d.x, d.y);
        return;
      }
      const ab = midpoint(a, b),
        bc = midpoint(b, c),
        cd = midpoint(c, d);
      const abc = midpoint(ab, bc),
        bcd = midpoint(bc, cd);
      const center = midpoint(abc, bcd);
      flatten(a, ab, abc, center, depth + 1);
      flatten(center, bcd, cd, d, depth + 1);
    };
    flatten(
      this.lastPoint(),
      { x: cx1, y: cy1 },
      { x: cx2, y: cy2 },
      { x, y },
      0,
    );
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.moveTo(x, y);
    this.lineTo(x + width, y);
    this.lineTo(x + width, y + height);
    this.lineTo(x, y + height);
    this.closePath();
  }

  roundRect(
    left: number,
    top: number,
    w: number,
    h: number,
    radius: number,
  ): void {
    const x = Math.min(left, left + w);
    const y = Math.min(top, top + h);
    const width = Math.abs(w);
    const height = Math.abs(h);
    const r = Math.min(radius, width / 2, height / 2);
    this.moveTo(x + r, y);
    this.lineTo(x + width - r, y);
    this.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
    this.lineTo(x + width, y + height - r);
    this.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
    this.lineTo(x + r, y + height);
    this.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
    this.lineTo(x, y + r);
    this.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    this.closePath();
  }

  arc(x: number, y: number, radius: number, start: number, end: number): void {
    this.ellipse(x, y, radius, radius, 0, start, end);
  }

  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
  ): void {
    const sweep = Math.min(Math.PI * 2, Math.max(0, end - start));
    const radius = Math.max(rx, ry);
    const step =
      radius > TOLERANCE ? 2 * Math.acos(1 - TOLERANCE / radius) : Math.PI / 2;
    const count = Math.max(1, Math.ceil(sweep / step));
    for (let i = 0; i <= count; i++) {
      const angle = start + (sweep * i) / count;
      const dx = Math.cos(angle) * rx,
        dy = Math.sin(angle) * ry;
      this.lineTo(
        x + dx * Math.cos(rotation) - dy * Math.sin(rotation),
        y + dx * Math.sin(rotation) + dy * Math.cos(rotation),
      );
    }
  }

  private lastPoint(): Point {
    if (!this.current) {
      this.moveTo(0, 0);
    }
    const points = this.current!.points;
    return points[points.length - 1];
  }
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
