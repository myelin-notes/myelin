import type { McpBounds } from './types';

/**
 * Canvas geometry reaches the model as JSON, where full float precision is pure
 * cost: `-166.05759058460694` is four times the tokens of `-166.1` and says
 * nothing extra, since every consumer either screenshots the rect or reasons
 * about layout. One decimal is well under a pixel.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

export function roundBounds(bounds: McpBounds): McpBounds {
  return {
    x: roundCoordinate(bounds.x),
    y: roundCoordinate(bounds.y),
    width: roundCoordinate(bounds.width),
    height: roundCoordinate(bounds.height),
  };
}
