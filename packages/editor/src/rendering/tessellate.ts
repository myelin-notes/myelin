import { GluTesselator, gluEnum, windingRule } from 'libtess';
import { type Contour, type Point, RenderPath } from './path';

/** Nonzero winding, matching Canvas 2D; intersections are resolved before alpha blending. */
export function tessellate(contours: readonly Contour[]): Float64Array {
  const vertices: number[] = [];
  const tess = new GluTesselator();
  tess.gluTessNormal(0, 0, 1);
  tess.gluTessProperty(
    gluEnum.GLU_TESS_WINDING_RULE,
    windingRule.GLU_TESS_WINDING_NONZERO,
  );
  // Registering an edge callback forces independent triangles instead of fans/strips.
  tess.gluTessCallback(gluEnum.GLU_TESS_EDGE_FLAG, () => {});
  tess.gluTessCallback(gluEnum.GLU_TESS_VERTEX, (point: number[]) =>
    vertices.push(point[0], point[1]),
  );
  tess.gluTessCallback(gluEnum.GLU_TESS_COMBINE, (point: number[]) => point);
  tess.gluTessCallback(gluEnum.GLU_TESS_ERROR, (code) => {
    throw new Error(`Path tessellation failed: ${code}`);
  });
  tess.gluTessBeginPolygon(null);
  for (const contour of contours) {
    if (contour.points.length < 3) {
      continue;
    }
    tess.gluTessBeginContour();
    for (const point of contour.points) {
      const vertex = [point.x, point.y, 0];
      tess.gluTessVertex(vertex, vertex);
    }
    tess.gluTessEndContour();
  }
  tess.gluTessEndPolygon();
  tess.gluDeleteTess();
  return new Float64Array(vertices);
}

export interface StrokeOptions {
  width: number;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  dash: number[];
  dashOffset: number;
}

export function strokeContours(
  contours: readonly Contour[],
  style: StrokeOptions,
): Contour[] {
  const result: Contour[] = [];
  const half = style.width / 2;
  const polygon = (points: Point[]) => {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    if (area < 0) {
      points.reverse();
    }
    result.push({ points, closed: true });
  };
  const circle = (point: Point) => {
    const path = new RenderPath();
    path.arc(point.x, point.y, half, 0, Math.PI * 2);
    result.push(...path.contours);
  };
  for (const contour of contours) {
    for (const run of dashContour(contour, style.dash, style.dashOffset)) {
      const points = run.points.filter(
        (p, i, all) =>
          i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-8,
      );
      if (points.length < 2) {
        continue;
      }
      if (run.closed && samePoint(points[0], points[points.length - 1])) {
        points.pop();
      }
      const count = run.closed ? points.length : points.length - 1;
      const normals: Point[] = [];
      for (let i = 0; i < count; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const dx = (b.x - a.x) / length,
          dy = (b.y - a.y) / length;
        const n = { x: -dy * half, y: dx * half };
        normals.push(n);
        const start =
          !run.closed && i === 0 && style.cap === 'square' ? half : 0;
        const end =
          !run.closed && i === count - 1 && style.cap === 'square' ? half : 0;
        polygon([
          { x: a.x + n.x - dx * start, y: a.y + n.y - dy * start },
          { x: a.x - n.x - dx * start, y: a.y - n.y - dy * start },
          { x: b.x - n.x + dx * end, y: b.y - n.y + dy * end },
          { x: b.x + n.x + dx * end, y: b.y + n.y + dy * end },
        ]);
      }
      for (
        let i = run.closed ? 0 : 1;
        i < (run.closed ? points.length : points.length - 1);
        i++
      ) {
        const p = points[i];
        if (style.join === 'round') {
          circle(p);
          continue;
        }
        const a = normals[(i + normals.length - 1) % normals.length],
          b = normals[i % normals.length];
        for (const sign of [-1, 1]) {
          const v1 = { x: p.x + a.x * sign, y: p.y + a.y * sign };
          const v2 = { x: p.x + b.x * sign, y: p.y + b.y * sign };
          const denom = half * half + a.x * b.x + a.y * b.y;
          const factor = denom > 1e-8 ? (half * half) / denom : 0;
          const m = {
            x: p.x + (a.x + b.x) * factor * sign,
            y: p.y + (a.y + b.y) * factor * sign,
          };
          if (
            style.join === 'miter' &&
            factor > 0 &&
            Math.hypot(m.x - p.x, m.y - p.y) <= half * 10
          ) {
            polygon([p, v1, m, v2]);
          } else {
            polygon([p, v1, v2]);
          }
        }
      }
      if (!run.closed && style.cap === 'round') {
        circle(points[0]);
        circle(points[points.length - 1]);
      }
    }
  }
  return result;
}

export function dashContour(
  contour: Contour,
  pattern: readonly number[],
  offset: number,
): Contour[] {
  const dash = pattern.length % 2 ? [...pattern, ...pattern] : [...pattern];
  const total = dash.reduce((sum, n) => sum + n, 0);
  if (!total) {
    return [contour];
  }
  let phase = ((offset % total) + total) % total;
  let index = 0;
  while (phase >= dash[index]) {
    phase -= dash[index];
    index = (index + 1) % dash.length;
  }
  let remaining = dash[index] - phase;
  const result: Contour[] = [];
  let run: Contour | null = null;
  const count = contour.closed
    ? contour.points.length
    : contour.points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = contour.points[i],
      b = contour.points[(i + 1) % contour.points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let distance = 0;
    while (distance < length - 1e-8) {
      if (remaining <= 1e-8) {
        index = (index + 1) % dash.length;
        remaining = dash[index];
        if (index % 2) {
          run = null;
        }
        continue;
      }
      const end = Math.min(length, distance + remaining);
      const pointAt = (d: number) => ({
        x: a.x + ((b.x - a.x) * d) / length,
        y: a.y + ((b.y - a.y) * d) / length,
      });
      if (index % 2 === 0) {
        if (!run) {
          run = { points: [pointAt(distance)], closed: false };
          result.push(run);
        }
        run.points.push(pointAt(end));
      }
      remaining -= end - distance;
      distance = end;
    }
  }
  if (contour.closed && result.length > 1) {
    const first = result[0],
      last = result[result.length - 1];
    if (samePoint(first.points[0], last.points[last.points.length - 1])) {
      first.points = [...last.points.slice(0, -1), ...first.points];
      result.pop();
    }
  }
  return result;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-8;
}
