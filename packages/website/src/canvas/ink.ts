import type { InkGesture } from '../content/site';

/**
 * Turns the compact gestures authored in content/site.ts into the flat
 * [x, y, pressure, ...] buffers StrokeElement stores. Deterministic jitter
 * (seeded per call site) keeps the strokes looking hand-drawn without the
 * page changing on every load.
 */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function push(
  points: number[],
  x: number,
  y: number,
  pressure: number,
): void {
  points.push(x, y, Math.min(0.95, Math.max(0.15, pressure)));
}

function underline(width: number, rand: () => number): number[] {
  const points: number[] = [];
  const steps = Math.max(24, Math.round(width / 9));
  const droop = 2 + rand() * 3;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wave = Math.sin(t * Math.PI * (2.5 + rand())) * 2.2;
    push(
      points,
      t * width + (rand() - 0.5) * 1.5,
      wave + droop * t + (rand() - 0.5) * 1.5,
      0.55 + 0.25 * Math.sin(t * Math.PI) + (rand() - 0.5) * 0.1,
    );
  }
  return points;
}

function circle(width: number, height: number, rand: () => number): number[] {
  const points: number[] = [];
  const rx = width / 2;
  const ry = height / 2;
  const start = -Math.PI * (0.55 + rand() * 0.2);
  const sweep = Math.PI * (2.15 + rand() * 0.15);
  const steps = 64;
  const tilt = (rand() - 0.5) * 0.25;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + sweep * t;
    const wobble = 1 + (rand() - 0.5) * 0.045;
    const x = Math.cos(a) * rx * wobble;
    const y = Math.sin(a) * ry * wobble;
    push(
      points,
      rx + x * Math.cos(tilt) - y * Math.sin(tilt),
      ry + x * Math.sin(tilt) + y * Math.cos(tilt),
      0.5 + 0.3 * Math.sin(t * Math.PI) + (rand() - 0.5) * 0.08,
    );
  }
  return points;
}

function arrow(dx: number, dy: number, rand: () => number): number[] {
  const points: number[] = [];
  const len = Math.hypot(dx, dy) || 1;
  const steps = Math.max(16, Math.round(len / 10));
  // Slightly bowed shaft.
  const nx = -dy / len;
  const ny = dx / len;
  const bow = len * (0.08 + rand() * 0.06) * (rand() > 0.5 ? 1 : -1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const arc = Math.sin(t * Math.PI) * bow;
    push(
      points,
      dx * t + nx * arc + (rand() - 0.5) * 1.5,
      dy * t + ny * arc + (rand() - 0.5) * 1.5,
      0.45 + 0.3 * t,
    );
  }
  // Head: back along one side, return to tip, back along the other.
  const head = Math.min(16, len * 0.35);
  const angle = Math.atan2(dy, dx);
  for (const side of [Math.PI * 0.8, -Math.PI * 0.8]) {
    const hx = dx + Math.cos(angle + side) * head;
    const hy = dy + Math.sin(angle + side) * head;
    const sub = 5;
    for (let i = 1; i <= sub; i++) {
      const t = i / sub;
      push(points, dx + (hx - dx) * t, dy + (hy - dy) * t, 0.7 - 0.3 * t);
    }
    for (let i = sub - 1; i >= 0; i--) {
      const t = i / sub;
      push(points, dx + (hx - dx) * t, dy + (hy - dy) * t, 0.5);
    }
  }
  return points;
}

/** A scrawled "line of writing" placeholder, like quick pen shorthand. */
function zigzag(width: number, rand: () => number): number[] {
  const points: number[] = [];
  const bumps = Math.max(6, Math.round(width / 26));
  const steps = bumps * 8;
  const amp = 7 + rand() * 3;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    push(
      points,
      t * width + (rand() - 0.5) * 2,
      Math.sin(t * Math.PI * bumps) * amp * (0.7 + 0.3 * Math.sin(t * 9)) +
        (rand() - 0.5) * 2,
      0.5 + (rand() - 0.5) * 0.15,
    );
  }
  return points;
}

function polyline(raw: [number, number][], rand: () => number): number[] {
  const points: number[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const [x0, y0] = raw[i];
    const [x1, y1] = raw[i + 1];
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(2, Math.round(dist / 8));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      push(
        points,
        x0 + (x1 - x0) * t + (rand() - 0.5) * 1.5,
        y0 + (y1 - y0) * t + (rand() - 0.5) * 1.5,
        0.55 + (rand() - 0.5) * 0.15,
      );
    }
  }
  const last = raw[raw.length - 1];
  push(points, last[0], last[1], 0.4);
  return points;
}

export function gestureToPoints(gesture: InkGesture, seed: number): number[] {
  const rand = mulberry32(seed);
  switch (gesture.path) {
    case 'underline':
      return underline(gesture.width, rand);
    case 'circle':
      return circle(gesture.width, gesture.height, rand);
    case 'arrow':
      return arrow(gesture.dx, gesture.dy, rand);
    case 'zigzag':
      return zigzag(gesture.width, rand);
    case 'points':
      return polyline(gesture.points, rand);
  }
}
