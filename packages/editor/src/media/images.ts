import type { DrawableCanvas } from '../drawable-canvas';
import { ImageElement } from '../elements/image-element';
import { getDevicePixelRatio } from '../utils';
import type { MediaImportOptions } from './index';

export async function imageImportHandler(
  blob: Blob,
  canvas: DrawableCanvas,
  options: MediaImportOptions = {},
) {
  const data = await blob.arrayBuffer();
  const img = canvas.addElement((uuid) => new ImageElement(uuid));
  await img.setImageData(data);

  // Place at given screen position (or center of viewport)
  const dpr = getDevicePixelRatio();
  const cx = options.screenX ?? canvas.ctx.canvas.width / dpr / 2;
  const cy = options.screenY ?? canvas.ctx.canvas.height / dpr / 2;
  const world = canvas.viewport.screenToWorld({ x: cx, y: cy });
  img.setOffset(
    world.x - img.naturalWidth / 2,
    world.y - img.naturalHeight / 2,
  );
  img.updateBounds();
}
