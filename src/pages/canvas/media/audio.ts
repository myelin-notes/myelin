import type { DrawableCanvas } from '../drawable-canvas';
import { AudioElement } from '../elements/audio/element';
import type { MediaImportOptions } from './index';

export async function audioImportHandler(
  blob: Blob,
  canvas: DrawableCanvas,
  options: MediaImportOptions = {},
) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const mimeType = blob.type || '';

  let duration = 0;
  try {
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    duration = decoded.duration;
    ctx.close();
  } catch {
    // duration stays 0
  }

  const fileName = blob instanceof File ? blob.name : 'audio';
  const el = canvas.addElement((uuid) => new AudioElement(uuid));
  el.setAudioData(bytes, fileName, duration, mimeType);

  const dpr = window.devicePixelRatio || 1;
  const cx = options.screenX ?? canvas.ctx.canvas.width / dpr / 2;
  const cy = options.screenY ?? canvas.ctx.canvas.height / dpr / 2;
  const world = canvas.viewport.screenToWorld({ x: cx, y: cy });
  el.setOffset(world.x - 140, world.y - 36);
  el.updateBounds();
}
