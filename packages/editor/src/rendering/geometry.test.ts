import { describe, expect, it } from 'vitest';
import { gridPhase } from './background';
import { RenderPath } from './path';
import { dashContour, strokeContours, tessellate } from './tessellate';

function area(vertices: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 6) {
    const ax = vertices[i],
      ay = vertices[i + 1],
      bx = vertices[i + 2],
      by = vertices[i + 3],
      cx = vertices[i + 4],
      cy = vertices[i + 5];
    sum += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
  }
  return sum;
}

describe('path geometry', () => {
  it('fills overlapping contours once, preserving translucent ink opacity', () => {
    const path = new RenderPath();
    path.rect(0, 0, 10, 10);
    path.rect(5, 0, 10, 10);
    expect(area(tessellate(path.contours))).toBeCloseTo(150);
  });

  it('preserves holes under the nonzero winding rule', () => {
    const path = new RenderPath();
    path.rect(0, 0, 10, 10);
    path.rect(2, 2, 6, 6);
    path.contours[1].points.reverse();
    expect(area(tessellate(path.contours))).toBeCloseTo(64);
  });

  it('resolves a self-intersecting lasso', () => {
    const path = new RenderPath();
    path.moveTo(0, 0);
    path.lineTo(10, 10);
    path.lineTo(0, 10);
    path.lineTo(10, 0);
    path.closePath();
    expect(area(tessellate(path.contours))).toBeCloseTo(50);
  });

  it('flattens a quadratic while retaining its curved area', () => {
    const path = new RenderPath();
    path.moveTo(0, 0);
    path.quadraticCurveTo(5, 10, 10, 0);
    path.closePath();
    expect(area(tessellate(path.contours))).toBeCloseTo(100 / 3, 0);
  });

  it('unions round joins and caps instead of blending overlapping primitives', () => {
    const path = new RenderPath();
    path.moveTo(0, 0);
    path.lineTo(10, 0);
    path.lineTo(0, 0);
    const contours = strokeContours(path.contours, {
      width: 4,
      cap: 'round',
      join: 'round',
      dash: [],
      dashOffset: 0,
    });
    expect(area(tessellate(contours))).toBeCloseTo(40 + Math.PI * 4, 0);
  });

  it('retains the interior of an outlined rectangle', () => {
    const path = new RenderPath();
    path.rect(0, 0, 10, 10);
    const contours = strokeContours(path.contours, {
      width: 2,
      cap: 'butt',
      join: 'miter',
      dash: [],
      dashOffset: 0,
    });
    expect(area(tessellate(contours))).toBeCloseTo(144 - 64);
  });

  it('keeps dash phase continuous through a corner', () => {
    const path = new RenderPath();
    path.moveTo(0, 0);
    path.lineTo(5, 0);
    path.lineTo(5, 10);
    const dashes = dashContour(path.contours[0], [6, 4], 0);
    expect(dashes.map((run) => run.points)).toEqual([
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 1 },
      ],
      [
        { x: 5, y: 5 },
        { x: 5, y: 10 },
      ],
    ]);
  });

  it('wraps negative animated dash offsets', () => {
    const path = new RenderPath();
    path.moveTo(0, 0);
    path.lineTo(20, 0);
    expect(dashContour(path.contours[0], [6, 4], -2)).toEqual(
      dashContour(path.contours[0], [6, 4], 8),
    );
  });
});

describe('grid phase', () => {
  it('stays anchored to world coordinates throughout zoom and negative pan', () => {
    for (const zoom of [0.05, 0.5, 1, 1.3, 2.8, 5]) {
      for (const offset of [-1e7, -412.25, 0, 37.5, 1e7]) {
        const tile = 24 * zoom;
        const phase = gridPhase(offset, zoom);
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThan(tile);
        const error = Math.abs((phase - offset * zoom) % tile);
        expect(Math.min(error, tile - error)).toBeLessThan(1e-6);
      }
    }
  });
});
