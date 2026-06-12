const WAVEFORM_BARS = 80;

export interface DecodedAudio {
  buffer: AudioBuffer;
  waveform: Float32Array;
  duration: number;
}

/** Single decode shared by the element, the player, and the import handler. */
export async function decodeAudio(bytes: Uint8Array): Promise<DecodedAudio> {
  const ctx = new AudioContext();
  try {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const decoded = await ctx.decodeAudioData(buffer as ArrayBuffer);
    const channel = decoded.getChannelData(0);
    const samplesPerBar = Math.max(
      1,
      Math.floor(channel.length / WAVEFORM_BARS),
    );
    const waveform = new Float32Array(WAVEFORM_BARS);
    for (let i = 0; i < WAVEFORM_BARS; i++) {
      let peak = 0;
      const start = i * samplesPerBar;
      const end = Math.min(start + samplesPerBar, channel.length);
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channel[j]);
        if (abs > peak) {
          peak = abs;
        }
      }
      waveform[i] = peak;
    }
    return { buffer: decoded, waveform, duration: decoded.duration };
  } finally {
    ctx.close();
  }
}

/** Does not clear the canvas — drawThumbnail paints onto an existing card. */
export function drawWaveform(
  ctx2d: CanvasRenderingContext2D,
  waveform: Float32Array,
  width: number,
  height: number,
  progress: number,
): void {
  const bars = waveform.length;
  const barW = 2;
  const gap = (width - bars * barW) / (bars - 1);
  const cx = width * progress;
  const minBarH = 3;

  for (let i = 0; i < bars; i++) {
    const x = i * (barW + gap);
    const barH = Math.max(minBarH, waveform[i] * height * 0.85);
    const y = (height - barH) / 2;
    ctx2d.fillStyle = x + barW < cx ? '#1c2738' : '#d0d5db';
    ctx2d.beginPath();
    ctx2d.roundRect(x, y, barW, barH, 1);
    ctx2d.fill();
  }
}
