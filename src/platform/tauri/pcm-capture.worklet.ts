/**
 * Mic capture for transcription, on the audio thread.
 *
 * Runs in an AudioWorkletGlobalScope, so it has none of the DOM lib's types and
 * imports nothing — Vite bundles it standalone via `?worker&url`.
 */

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void;

/** ~85ms at 48kHz — one Tauri invoke per chunk, and the cadence the backend's idle timeout expects. */
const CHUNK_SAMPLES = 4096;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly buffer = new Float32Array(CHUNK_SAMPLES);
  private filled = 0;

  public process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (!channels || channels.length === 0) {
      return true;
    }

    const frames = channels[0].length;
    for (let frame = 0; frame < frames; frame++) {
      let sum = 0;
      for (const channel of channels) {
        sum += channel[frame];
      }
      this.buffer[this.filled] = sum / channels.length;
      this.filled++;
      if (this.filled === CHUNK_SAMPLES) {
        // Copied out rather than transferred whole: `buffer` is reused for the next chunk.
        const chunk = this.buffer.slice(0, CHUNK_SAMPLES);
        this.filled = 0;
        this.port.postMessage(chunk, [chunk.buffer]);
      }
    }

    // The node is disconnected to stop capture; never end the processor from here.
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
