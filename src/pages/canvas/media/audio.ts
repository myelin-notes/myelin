import { getDevicePixelRatio } from '@/lib/utils';
import type { DrawableCanvas } from '../drawable-canvas';
import {
  AUDIO_NATURAL_HEIGHT,
  AUDIO_NATURAL_WIDTH,
  AudioElement,
} from '../elements/audio/element';
import { decodeAudio } from '../elements/audio/waveform';
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
  let waveform: Float32Array | null = null;
  try {
    const decoded = await decodeAudio(bytes);
    duration = decoded.duration;
    waveform = decoded.waveform;
  } catch {
    // undecodable input: duration stays 0, no waveform
  }

  // Imports are not transcribed automatically — the player view offers an
  // on-demand transcribe button instead, since a full-file whisper run over
  // an arbitrarily long import is too expensive to fire unprompted.
  const fileName = blob instanceof File ? blob.name : 'audio';
  const el = canvas.addElement(
    (uuid) => new AudioElement(uuid, canvas.localPeerId),
  );
  el.setAudioData(bytes, fileName, duration, mimeType, waveform);

  const dpr = getDevicePixelRatio();
  const cx = options.screenX ?? canvas.ctx.canvas.width / dpr / 2;
  const cy = options.screenY ?? canvas.ctx.canvas.height / dpr / 2;
  const world = canvas.viewport.screenToWorld({ x: cx, y: cy });
  el.setOffset(
    world.x - AUDIO_NATURAL_WIDTH / 2,
    world.y - AUDIO_NATURAL_HEIGHT / 2,
  );
  el.updateBounds();
}
