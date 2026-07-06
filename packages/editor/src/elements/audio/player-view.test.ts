import { describe, expect, it } from 'vitest';
import {
  getAudioPlayerInteractionState,
  getWaveformCanvasMetrics,
} from './player-view';

describe('getWaveformCanvasMetrics', () => {
  it('uses the device pixel ratio for ordinary waveform sizes', () => {
    expect(getWaveformCanvasMetrics(188, 28, 2)).toEqual({
      cssWidth: 188,
      cssHeight: 28,
      pixelRatio: 2,
      backingWidth: 376,
      backingHeight: 56,
    });
  });

  it('caps the backing store for very large zoomed waveforms', () => {
    const metrics = getWaveformCanvasMetrics(3000, 2000, 2);

    expect(metrics.backingWidth).toBe(4096);
    expect(metrics.backingHeight).toBeLessThanOrEqual(4096);
  });
});

describe('getAudioPlayerInteractionState', () => {
  it('disables the primary button for non-creators until audio exists', () => {
    const state = getAudioPlayerInteractionState({
      audioBytes: null,
      transcript: '',
      isCreator: false,
      isTranscribing: false,
    });

    expect(state.primaryButtonDisabled).toBe(true);
    expect(state.isWaitingForRemoteAudio).toBe(true);
  });

  it('shows captions as loading for non-creators until transcript exists', () => {
    const state = getAudioPlayerInteractionState({
      audioBytes: new Uint8Array([1]),
      transcript: '',
      isCreator: false,
      isTranscribing: false,
    });

    expect(state.captionsButtonDisabled).toBe(true);
    expect(state.isCaptionsLoading).toBe(true);
  });

  it('allows captions once the transcript has synced', () => {
    const state = getAudioPlayerInteractionState({
      audioBytes: new Uint8Array([1]),
      transcript: 'hello',
      isCreator: false,
      isTranscribing: false,
    });

    expect(state.captionsButtonDisabled).toBe(false);
    expect(state.isCaptionsLoading).toBe(false);
  });
});
