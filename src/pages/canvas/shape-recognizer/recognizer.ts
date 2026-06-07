/**
 * Pure, stateless handwriting → vector-shape recognizer.
 *
 * No canvas / Yjs / perfect-freehand imports — operates on raw [x, y] points
 * so it can be exhaustively unit-tested. Geometry is returned in WORLD space;
 * the caller normalizes to a local frame at swap time.
 */

import {
  CIRCULARITY_MIN,
  CLOSED_RATIO,
  CORNER_ANGLE_DEG,
  CORNER_CLUSTER_WINDOW,
  ELLIPSE_STRONG,
  LINE_DEVIATION_RATIO,
  MIN_CONFIDENCE,
  MIN_LINE_SPAN,
  MIN_POINTS,
  RECT_ASPECT_MAX,
  RECT_ASPECT_MIN,
  RECT_MAX_CIRC,
  RESAMPLE_N,
} from './config';

export type ShapeType = 'rect' | 'ellipse' | 'line' | 'triangle';

export interface ShapeRecognition {
  shapeType: ShapeType;
  /** World-space geometry: box [x,y,w,h] | line [ax,ay,bx,by] | triangle [x0..y2]. */
  geom: number[];
  confidence: number;
}

type Point = readonly [number, number];

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Resample a polyline to N points spaced uniformly in arc length. This removes
 * pen-speed bias (samples are even in distance, not time) and bounds the cost of
 * downstream corner detection for very long strokes. Returns null for a
 * zero-length input.
 */
export function resampleByArcLength(
  pts: readonly Point[],
  n = RESAMPLE_N,
): Point[] | null {
  if (pts.length < 2 || n < 2) {
    return null;
  }
  const cumulative: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cumulative.push(cumulative[i - 1] + dist(pts[i - 1], pts[i]));
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= 1e-9) {
    return null;
  }

  const out: Point[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (seg < cumulative.length - 2 && cumulative[seg + 1] < target) {
      seg++;
    }
    const segStart = cumulative[seg];
    const segEnd = cumulative[seg + 1];
    const span = segEnd - segStart;
    const t = span <= 1e-9 ? 0 : (target - segStart) / span;
    const a = pts[seg];
    const b = pts[seg + 1];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
}

function bbox(pts: readonly Point[]): Bbox {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of pts) {
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function pathLength(pts: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += dist(pts[i - 1], pts[i]);
  }
  return total;
}

/** Shoelace polygon area (absolute) of a closed polyline. */
function polygonArea(pts: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) / 2;
}

/** Circularity in [0,1]: 1 for a perfect circle, lower for jagged shapes. */
function circularity(pts: readonly Point[]): number {
  const perimeter = pathLength(pts);
  if (perimeter <= 1e-9) {
    return 0;
  }
  const c = (4 * Math.PI * polygonArea(pts)) / (perimeter * perimeter);
  return Math.min(1, c);
}

/**
 * Least-squares line fit (total least squares via covariance) and the maximum
 * perpendicular deviation of the points from that line.
 */
function lineFitDeviation(pts: readonly Point[]): {
  maxDev: number;
  a: Point;
  b: Point;
} {
  const n = pts.length;
  let mx = 0;
  let my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    const dx = x - mx;
    const dy = y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // Principal direction (largest-eigenvalue eigenvector of the covariance).
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dirX = Math.cos(theta);
  const dirY = Math.sin(theta);
  // Normal = perpendicular to direction.
  const nx = -dirY;
  const ny = dirX;

  let maxDev = 0;
  let minProj = Number.POSITIVE_INFINITY;
  let maxProj = Number.NEGATIVE_INFINITY;
  let minPt: Point = pts[0];
  let maxPt: Point = pts[0];
  for (const p of pts) {
    const dx = p[0] - mx;
    const dy = p[1] - my;
    const dev = Math.abs(dx * nx + dy * ny);
    if (dev > maxDev) {
      maxDev = dev;
    }
    const proj = dx * dirX + dy * dirY;
    if (proj < minProj) {
      minProj = proj;
      minPt = p;
    }
    if (proj > maxProj) {
      maxProj = proj;
      maxPt = p;
    }
  }
  return { maxDev, a: minPt, b: maxPt };
}

/**
 * Detect corners via turn angle, then cluster adjacent corners so one physical
 * corner counts once. Returns the clustered corner vertex positions.
 */
function detectCorners(pts: readonly Point[], closed: boolean): Point[] {
  const n = pts.length;
  const cornerIdx: number[] = [];
  const start = closed ? 0 : 1;
  const end = closed ? n : n - 1;
  for (let i = start; i < end; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i % n];
    const next = pts[(i + 1) % n];
    const v1x = cur[0] - prev[0];
    const v1y = cur[1] - prev[1];
    const v2x = next[0] - cur[0];
    const v2y = next[1] - cur[1];
    const m1 = Math.hypot(v1x, v1y);
    const m2 = Math.hypot(v2x, v2y);
    if (m1 <= 1e-9 || m2 <= 1e-9) {
      continue;
    }
    let cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
    cos = Math.max(-1, Math.min(1, cos));
    const turnDeg = (Math.acos(cos) * 180) / Math.PI;
    if (turnDeg > CORNER_ANGLE_DEG) {
      cornerIdx.push(i % n);
    }
  }

  // Cluster corners that fall within CORNER_CLUSTER_WINDOW index steps.
  const clusters: Point[] = [];
  let group: number[] = [];
  const flush = () => {
    if (group.length === 0) {
      return;
    }
    // Pick the index in the group with the sharpest turn → use middle as proxy.
    const mid = group[Math.floor(group.length / 2)];
    clusters.push(pts[mid]);
    group = [];
  };
  for (let k = 0; k < cornerIdx.length; k++) {
    if (group.length === 0) {
      group.push(cornerIdx[k]);
      continue;
    }
    if (cornerIdx[k] - group[group.length - 1] <= CORNER_CLUSTER_WINDOW) {
      group.push(cornerIdx[k]);
    } else {
      flush();
      group.push(cornerIdx[k]);
    }
  }
  flush();

  // For closed strokes, the first and last clusters may wrap around to the same
  // physical corner; merge if they are close in index space.
  if (closed && clusters.length >= 2 && cornerIdx.length >= 2) {
    const first = cornerIdx[0];
    const last = cornerIdx[cornerIdx.length - 1];
    if (n - last + first <= CORNER_CLUSTER_WINDOW) {
      clusters.pop();
    }
  }

  return clusters;
}

export function recognizeShape(
  points: readonly Point[],
): ShapeRecognition | null {
  if (points.length < MIN_POINTS) {
    return null;
  }
  const pts = resampleByArcLength(points, RESAMPLE_N);
  if (!pts) {
    return null;
  }

  const box = bbox(pts);
  const longSide = Math.max(box.w, box.h);
  const span = dist(pts[0], pts[pts.length - 1]);
  const L = pathLength(pts);
  if (longSide <= 1e-6 || L <= 1e-6) {
    return null;
  }

  // LINE first — most robust and most distinct.
  const { maxDev, a, b } = lineFitDeviation(pts);
  const deviationRatio = maxDev / longSide;
  const lineSpan = dist(a, b);
  if (deviationRatio < LINE_DEVIATION_RATIO && lineSpan >= MIN_LINE_SPAN) {
    const confidence = 1 - deviationRatio / LINE_DEVIATION_RATIO;
    if (confidence >= MIN_CONFIDENCE) {
      return {
        shapeType: 'line',
        geom: [a[0], a[1], b[0], b[1]],
        confidence,
      };
    }
  }

  const closeRatio = span / L;
  const closed = closeRatio < CLOSED_RATIO;
  const C = circularity(pts);
  const aspect = box.h <= 1e-9 ? Number.POSITIVE_INFINITY : box.w / box.h;
  // For corner detection on a closed stroke, drop a duplicated final vertex so
  // the wrap-around turn at the start corner isn't masked by a zero-length edge.
  const cornerPts =
    closed && dist(pts[0], pts[pts.length - 1]) < longSide * 0.02
      ? pts.slice(0, -1)
      : pts;
  const corners = detectCorners(cornerPts, closed);
  const cornerCount = corners.length;

  // Strong-circularity precedence: a very round closed stroke is ALWAYS an
  // ellipse, regardless of how many corners the detector hallucinated.
  if (closed && C > ELLIPSE_STRONG) {
    return {
      shapeType: 'ellipse',
      geom: [box.minX, box.minY, box.w, box.h],
      confidence: Math.min(1, C),
    };
  }

  if (closed && C > CIRCULARITY_MIN && cornerCount <= 1) {
    return {
      shapeType: 'ellipse',
      geom: [box.minX, box.minY, box.w, box.h],
      confidence: Math.min(1, C),
    };
  }

  const axisAligned = closeRatio; // smaller close gap → cleaner closed shape

  if (
    closed &&
    cornerCount === 4 &&
    aspect >= RECT_ASPECT_MIN &&
    aspect <= RECT_ASPECT_MAX &&
    C < RECT_MAX_CIRC
  ) {
    const confidence = Math.min(1, 0.7 + (1 - axisAligned) * 0.3);
    if (confidence >= MIN_CONFIDENCE) {
      return {
        shapeType: 'rect',
        geom: [box.minX, box.minY, box.w, box.h],
        confidence,
      };
    }
  }

  if (closed && cornerCount === 3 && C < RECT_MAX_CIRC) {
    const confidence = Math.min(1, 0.7 + (1 - axisAligned) * 0.3);
    if (confidence >= MIN_CONFIDENCE) {
      return {
        shapeType: 'triangle',
        geom: [
          corners[0][0],
          corners[0][1],
          corners[1][0],
          corners[1][1],
          corners[2][0],
          corners[2][1],
        ],
        confidence,
      };
    }
  }

  return null;
}
