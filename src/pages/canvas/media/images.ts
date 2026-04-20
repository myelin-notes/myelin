import type { DrawableCanvas } from '../drawable-canvas';
import { ImageElement } from '../elements/image-element';

export async function imageImportHandler(
  blob: Blob,
  canvas: DrawableCanvas,
  screenX?: number,
  screenY?: number,
) {
  const data = await blob.arrayBuffer();
  const img = canvas.addElement((i) => new ImageElement(i));
  await img.setImageData(data);

  // Place at given screen position (or center of viewport)
  const dpr = window.devicePixelRatio || 1;
  const cx = screenX ?? canvas.ctx.canvas.width / dpr / 2;
  const cy = screenY ?? canvas.ctx.canvas.height / dpr / 2;
  const world = canvas.viewport.screenToWorld({ x: cx, y: cy });
  img.setOffset(
    world.x - img.naturalWidth / 2,
    world.y - img.naturalHeight / 2,
  );
  img.updateBounds();
  canvas.updateBounding();
}
