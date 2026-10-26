export interface Vector2 {
  x: number;
  y: number;
}

/** Rotates `v` about the origin; positive `angle` (radians) turns clockwise on the y-down canvas. */
export function rotateVector(v: Vector2, angle: number): Vector2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}
