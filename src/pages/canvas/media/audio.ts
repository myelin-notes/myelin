import type { DrawableCanvas } from '../drawable-canvas';
import {
  AUDIO_NATURAL_HEIGHT,
  AUDIO_NATURAL_WIDTH,
  AudioElement,
} from '../elements/audio/element';
import { decodeAudio } from '../elements/audio/player-view';
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
    duration = (await decodeAudio(bytes)).duration;
  } catch {
    // duration stays 0
  }

  // Imports are not transcribed automatically — the player view offers an
  // on-demand transcribe button instead, since a full-file whisper run over
  // an arbitrarily long import is too expensive to fire unprompted.
  const fileName = blob instanceof File ? blob.name : 'audio';
  const el = canvas.addElement((uuid) => new AudioElement(uuid));
  el.setAudioData(bytes, fileName, duration, mimeType);

  const dpr = window.devicePixelRatio || 1;
  const cx = options.screenX ?? canvas.ctx.canvas.width / dpr / 2;
  const cy = options.screenY ?? canvas.ctx.canvas.height / dpr / 2;
  const world = canvas.viewport.screenToWorld({ x: cx, y: cy });
  el.setOffset(
    world.x - AUDIO_NATURAL_WIDTH / 2,
    world.y - AUDIO_NATURAL_HEIGHT / 2,
  );
  el.updateBounds();
}
