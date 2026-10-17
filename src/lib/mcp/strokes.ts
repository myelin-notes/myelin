import type * as Y from 'yjs';
import { ElementType } from '@myelin/editor/elements/element-type';
import type { YDocManager } from '@myelin/editor/ydoc-manager';
import type { VFSNodeId } from '@/lib/sync';
import { getMcpElementBounds } from './read-model';
import type {
  McpBounds,
  McpStrokePath,
  McpStrokeStyle,
  McpStrokesRead,
} from './types';

export interface McpStrokeReadOptions {
  region: McpBounds | null;
  /** Max deviation, in canvas px, of the simplified path from the recorded one. 0 keeps every point. */
  tolerance: number;
  includePressure: boolean;
  includeIds: boolean;
  limit: number;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function intersects(a: McpBounds, b: McpBounds): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

function segmentDistanceSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared),
        );
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

// Ramer–Douglas–Peucker against the segment rather than the infinite line, so a closed loop (an
// "o", whose ends coincide) still keeps its far side.
function simplifiedIndices(
  xs: number[],
  ys: number[],
  tolerance: number,
): number[] {
  const count = xs.length;
  if (count <= 2 || tolerance <= 0) {
    return xs.map((_, index) => index);
  }

  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const toleranceSquared = tolerance * tolerance;
  const spans: [number, number][] = [[0, count - 1]];
  while (spans.length > 0) {
    const [start, end] = spans.pop()!;
    let farthest = -1;
    let farthestDistance = toleranceSquared;
    for (let index = start + 1; index < end; index++) {
      const distance = segmentDistanceSquared(
        xs[index],
        ys[index],
        xs[start],
        ys[start],
        xs[end],
        ys[end],
      );
      if (distance > farthestDistance) {
        farthest = index;
        farthestDistance = distance;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      spans.push([start, farthest], [farthest, end]);
    }
  }

  const indices: number[] = [];
  for (let index = 0; index < count; index++) {
    if (keep[index]) {
      indices.push(index);
    }
  }
  return indices;
}

function formatNumber(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}

function strokePath(
  yMap: Y.Map<unknown>,
  origin: { x: number; y: number },
  options: McpStrokeReadOptions,
): string {
  const raw = yMap.get('points');
  const points = Array.isArray(raw) ? (raw as number[]) : [];
  const offsetX = numberOr(yMap.get('offsetX'), 0);
  const offsetY = numberOr(yMap.get('offsetY'), 0);
  const scaleX = numberOr(yMap.get('scaleX'), 1);
  const scaleY = numberOr(yMap.get('scaleY'), 1);

  const xs: number[] = [];
  const ys: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index + 1 < points.length; index += 3) {
    xs.push(points[index] * scaleX + offsetX - origin.x);
    ys.push(points[index + 1] * scaleY + offsetY - origin.y);
    pressures.push(numberOr(points[index + 2], 0));
  }

  // Whole pixels are below what the default tolerance preserves anyway; finer tolerances are for
  // ink written while zoomed in, where a pixel is a large share of a letter.
  const decimals = options.tolerance >= 1 ? 0 : 1;
  // Pressure-less strokes store 0 per point; echoing that would make create_strokes draw the
  // copy at zero width.
  const withPressure =
    options.includePressure && yMap.get('hasPressure') === true;
  const tokens: string[] = [];
  for (const index of simplifiedIndices(xs, ys, options.tolerance)) {
    let token = `${formatNumber(xs[index], decimals)},${formatNumber(ys[index], decimals)}`;
    if (withPressure) {
      token += `,${formatNumber(pressures[index], 2)}`;
    }
    if (token !== tokens[tokens.length - 1]) {
      tokens.push(token);
    }
  }
  return tokens.join(' ');
}

export function readMcpStrokes(
  ydoc: YDocManager,
  noteId: VFSNodeId,
  options: McpStrokeReadOptions,
): McpStrokesRead {
  const matched: { yMap: Y.Map<unknown>; bounds: McpBounds }[] = [];
  for (let index = 0; index < ydoc.elements.length; index++) {
    const yMap = ydoc.elements.get(index);
    if (yMap.get('type') !== ElementType.STROKE) {
      continue;
    }
    const bounds = getMcpElementBounds(yMap);
    if (!options.region || intersects(bounds, options.region)) {
      matched.push({ yMap, bounds });
    }
  }

  const returned = matched.slice(0, options.limit);
  let origin = { x: 0, y: 0 };
  if (options.region) {
    origin = {
      x: Math.floor(options.region.x),
      y: Math.floor(options.region.y),
    };
  } else if (returned.length > 0) {
    origin = {
      x: Math.floor(Math.min(...returned.map(({ bounds }) => bounds.x))),
      y: Math.floor(Math.min(...returned.map(({ bounds }) => bounds.y))),
    };
  }

  const styles: McpStrokeStyle[] = [];
  const styleIndex = new Map<string, number>();
  const strokes = returned.map(({ yMap }): McpStrokePath => {
    const style: McpStrokeStyle = {
      color: stringOr(yMap.get('color'), ''),
      size: Math.round(numberOr(yMap.get('size'), 0) * 10) / 10,
      pressure: yMap.get('hasPressure') === true,
    };
    const key = `${style.color}|${style.size}|${style.pressure}`;
    let index = styleIndex.get(key);
    if (index === undefined) {
      index = styles.length;
      styles.push(style);
      styleIndex.set(key, index);
    }
    return {
      ...(options.includeIds ? { id: stringOr(yMap.get('uuid'), '') } : {}),
      style: index,
      points: strokePath(yMap, origin, options),
    };
  });

  return { noteId, origin, total: matched.length, styles, strokes };
}

export interface ParsedStrokePoints {
  /** Flat `[x, y, pressure, ...]` in canvas coordinates, as `StrokeElement` stores them. */
  points: number[];
  hasPressure: boolean;
}

/** Parse the `x,y` / `x,y,p` format read_strokes emits, offsetting by `origin`. */
export function parseStrokePoints(
  text: string,
  origin: { x: number; y: number },
  label: string,
): ParsedStrokePoints {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`${label} has no points.`);
  }

  const parsed = tokens.map((token) => {
    const parts = token.split(',');
    const values = parts.map(Number);
    if (
      (parts.length !== 2 && parts.length !== 3) ||
      values.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(
        `${label}: expected "x,y" or "x,y,pressure" but got "${token}".`,
      );
    }
    return values;
  });

  const hasPressure = parsed.some((values) => values.length === 3);
  const points: number[] = [];
  for (const [x, y, pressure] of parsed) {
    points.push(
      x + origin.x,
      y + origin.y,
      // A point without pressure in a stroke that has some draws at mid width.
      hasPressure ? Math.max(0, Math.min(1, pressure ?? 0.5)) : 0,
    );
  }
  return { points, hasPressure };
}
