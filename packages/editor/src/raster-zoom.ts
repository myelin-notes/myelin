/**
 * The zoom levels layers are actually painted at.
 *
 * Sizing a layer to the exact zoom repaints it every zoom frame; painting at fixed steps and
 * carrying the remainder on the layer's transform lets the compositor scale the existing texture.
 * Half-octave steps put that remainder in [1, √2): always scaled up, never down, so a layer can't
 * shrink away from the area it was sized to cover, and is never more than 41% softer than a fresh
 * paint before the next step repaints it sharp.
 */
export function quantizeRasterZoom(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) {
    return 1;
  }
  // In log2, not log(zoom)/log(√2): the latter puts an exact 2x zoom at 1.9999999999999998, which
  // floors into the step below and leaves a layer permanently scaled at a round zoom level.
  return 2 ** (Math.floor(Math.log2(zoom) * 2) / 2);
}
