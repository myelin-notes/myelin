import { describe, expect, it } from 'vitest';
import { recognizeShape, resampleByArcLength } from './recognizer';

type Pt = [number, number];

function jitter(pts: Pt[], amount: number, seed = 1): Pt[] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
  return pts.map(([x, y]) => [x + rand() * amount, y + rand() * amount]);
}

/** Dense polyline along the perimeter of a rectangle (closed). */
function rectStroke(
  x: number,
  y: number,
  w: number,
  h: number,
  per = 20,
): Pt[] {
  const corners: Pt[] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ];
  const out: Pt[] = [];
  for (let c = 0; c < corners.length - 1; c++) {
    const [ax, ay] = corners[c];
    const [bx, by] = corners[c + 1];
    for (let i = 0; i < per; i++) {
      const t = i / per;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  out.push([x, y]);
  return out;
}

/** Moving-average smoothing — approximates the rounded corners a real hand draws. */
function smooth(pts: Pt[], k: number): Pt[] {
  const n = pts.length;
  return pts.map((_, i) => {
    let sx = 0;
    let sy = 0;
    for (let j = -k; j <= k; j++) {
      const p = pts[(i + j + n) % n];
      sx += p[0];
      sy += p[1];
    }
    return [sx / (2 * k + 1), sy / (2 * k + 1)] as Pt;
  });
}

function ellipseStroke(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n = 80,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

function lineStroke(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  n = 40,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
  return out;
}

function triangleStroke(per = 20): Pt[] {
  const corners: Pt[] = [
    [100, 0],
    [200, 180],
    [0, 180],
    [100, 0],
  ];
  const out: Pt[] = [];
  for (let c = 0; c < corners.length - 1; c++) {
    const [ax, ay] = corners[c];
    const [bx, by] = corners[c + 1];
    for (let i = 0; i < per; i++) {
      const t = i / per;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  out.push([100, 0]);
  return out;
}

describe('resampleByArcLength', () => {
  it('returns null for a zero-length stroke', () => {
    expect(
      resampleByArcLength(
        [
          [5, 5],
          [5, 5],
        ],
        16,
      ),
    ).toBeNull();
  });

  it('preserves corner positions of a known polyline', () => {
    const square = rectStroke(0, 0, 100, 100, 30);
    const resampled = resampleByArcLength(square, 64)!;
    expect(resampled).toHaveLength(64);
    // Every true corner should be near some resampled vertex.
    const corners: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    for (const [cx, cy] of corners) {
      const minDist = Math.min(
        ...resampled.map(([x, y]) => Math.hypot(x - cx, y - cy)),
      );
      expect(minDist).toBeLessThan(6);
    }
  });

  it('produces uniform arc-length spacing', () => {
    const line = lineStroke(0, 0, 100, 0, 50);
    const resampled = resampleByArcLength(line, 11)!;
    for (let i = 1; i < resampled.length; i++) {
      const d = Math.hypot(
        resampled[i][0] - resampled[i - 1][0],
        resampled[i][1] - resampled[i - 1][1],
      );
      expect(d).toBeCloseTo(10, 1);
    }
  });
});

describe('recognizeShape', () => {
  it('classifies a clean rectangle', () => {
    const r = recognizeShape(rectStroke(10, 20, 200, 120))!;
    expect(r).not.toBeNull();
    expect(r.shapeType).toBe('rect');
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.geom[0]).toBeCloseTo(10, 0);
    expect(r.geom[1]).toBeCloseTo(20, 0);
    expect(r.geom[2]).toBeCloseTo(200, 0);
    expect(r.geom[3]).toBeCloseTo(120, 0);
  });

  it('classifies a jittered rectangle', () => {
    const r = recognizeShape(jitter(rectStroke(0, 0, 150, 150), 2));
    expect(r?.shapeType).toBe('rect');
  });

  it('classifies a square with rounded corners as rect, not ellipse', () => {
    // A real hand rounds the corners of a square, pushing circularity to ~0.86 — past ELLIPSE_STRONG —
    // and hiding the corners from the turn-angle detector. Only the bbox fill ratio still says "box".
    for (const k of [3, 6, 10]) {
      const r = recognizeShape(smooth(rectStroke(0, 0, 120, 120, 50), k));
      expect(r?.shapeType, `smoothing ${k}`).toBe('rect');
    }
  });

  it('classifies a heavily jittered square as rect', () => {
    const r = recognizeShape(jitter(rectStroke(0, 0, 120, 120, 50), 7));
    expect(r?.shapeType).toBe('rect');
  });

  it('classifies a clean circle as ellipse', () => {
    const r = recognizeShape(ellipseStroke(100, 100, 60, 60))!;
    expect(r.shapeType).toBe('ellipse');
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it('classifies a jittered ellipse, not a rect', () => {
    const r = recognizeShape(jitter(ellipseStroke(0, 0, 80, 50), 3));
    expect(r?.shapeType).toBe('ellipse');
  });

  it('forces ellipse for a wobbly circle even with spurious corners', () => {
    // Sinusoidal radius wobble injects oscillations a corner detector may read
    // as corners, but circularity stays high → must remain an ellipse.
    const wobble: Pt[] = [];
    const n = 100;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 70 + Math.sin(a * 4) * 4;
      wobble.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const res = recognizeShape(wobble);
    expect(res?.shapeType).toBe('ellipse');
    expect(res?.shapeType).not.toBe('rect');
  });

  it('classifies a straight line', () => {
    const r = recognizeShape(jitter(lineStroke(0, 0, 200, 50), 1))!;
    expect(r.shapeType).toBe('line');
    // Endpoints near the extremes.
    expect(Math.hypot(r.geom[0] - 0, r.geom[1] - 0)).toBeLessThan(15);
    expect(Math.hypot(r.geom[2] - 200, r.geom[3] - 50)).toBeLessThan(15);
  });

  it('classifies a wobbly freehand line', () => {
    // ~3% perpendicular wobble: typical of a hand-drawn line and well within LINE_DEVIATION_RATIO
    // (6%), but rejected by the old MIN_CONFIDENCE double gate that capped tolerance at ~1.8%.
    const r = recognizeShape(jitter(lineStroke(0, 0, 220, 60), 6, 7))!;
    expect(r).not.toBeNull();
    expect(r.shapeType).toBe('line');
  });

  it('snaps a near-horizontal line flat', () => {
    // ~2.9deg tilt — inside LINE_HORIZONTAL_SNAP_DEG.
    const r = recognizeShape(jitter(lineStroke(0, 100, 200, 110), 1))!;
    expect(r.shapeType).toBe('line');
    expect(r.geom[1]).toBeCloseTo(r.geom[3], 6);
  });

  it('leaves a clearly tilted line alone', () => {
    // ~14deg tilt — outside LINE_HORIZONTAL_SNAP_DEG.
    const r = recognizeShape(jitter(lineStroke(0, 100, 200, 150), 1))!;
    expect(r.shapeType).toBe('line');
    expect(Math.abs(r.geom[3] - r.geom[1])).toBeGreaterThan(30);
  });

  it('rejects a too-short stroke', () => {
    expect(recognizeShape(lineStroke(0, 0, 5, 0, 10))).toBeNull();
  });

  it('classifies a closed triangle', () => {
    const r = recognizeShape(triangleStroke())!;
    expect(r.shapeType).toBe('triangle');
    expect(r.geom).toHaveLength(6);
  });

  it('rejects an open zigzag', () => {
    const zigzag: Pt[] = [
      [0, 0],
      [50, 100],
      [100, 0],
      [150, 100],
      [200, 0],
    ];
    const dense: Pt[] = [];
    for (let c = 0; c < zigzag.length - 1; c++) {
      for (let i = 0; i < 15; i++) {
        const t = i / 15;
        dense.push([
          zigzag[c][0] + (zigzag[c + 1][0] - zigzag[c][0]) * t,
          zigzag[c][1] + (zigzag[c + 1][1] - zigzag[c][1]) * t,
        ]);
      }
    }
    expect(recognizeShape(dense)).toBeNull();
  });

  it('rejects fewer than MIN_POINTS points', () => {
    expect(
      recognizeShape([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ).toBeNull();
  });

  it('rejects a random squiggle', () => {
    const squiggle: Pt[] = [];
    for (let i = 0; i < 60; i++) {
      squiggle.push([
        Math.sin(i * 0.7) * 50 + i,
        Math.cos(i * 1.3) * 40 + Math.sin(i * 0.3) * 20,
      ]);
    }
    expect(recognizeShape(squiggle)).toBeNull();
  });

  it('resamples a 1000-point rectangle and keeps corners', () => {
    const big = rectStroke(0, 0, 300, 200, 250);
    expect(big.length).toBeGreaterThan(1000);
    const r = recognizeShape(big)!;
    expect(r.shapeType).toBe('rect');
    expect(r.geom[2]).toBeCloseTo(300, 0);
    expect(r.geom[3]).toBeCloseTo(200, 0);
  });
});
