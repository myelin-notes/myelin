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
      slot: { kind: 'none' },
    });

    expect(state.primaryButtonDisabled).toBe(true);
    expect(state.isWaitingForRemoteAudio).toBe(true);
  });

  it('shows captions as loading while a valid remote claim is transcribing', () => {
    const state = getAudioPlayerInteractionState({
      audioBytes: new Uint8Array([1]),
      transcript: '',
      isCreator: false,
      slot: { kind: 'transcribing-remote', peerId: 'peer-b' },
    });

    expect(state.captionsButtonDisabled).toBe(true);
    expect(state.isCaptionsLoading).toBe(true);
  });

  it('disables captions when no capable client can transcribe here', () => {
    const state = getAudioPlayerInteractionState({
      audioBytes: new Uint8Array([1]),
      transcript: '',
      isCreator: false,
      slot: { kind: 'unavailable' },
    });

    expect(state.captionsButtonDisabled).toBe(true);
    expect(state.isCaptionsLoading).toBe(false);
  });

  it('enables the transcribe affordance for a capable eligible client', () => {
    const state = getAudioPlayerInteractionState({
      audioBytes: new Uint8Array([1]),
      transcript: '',
      isCreator: false,
      slot: { kind: 'can-transcribe' },
    });

    expect(state.captionsButtonDisabled).toBe(false);
    expect(state.isCaptionsLoading).toBe(false);
  });

  it('allows captions once the transcript has synced', () => {
    const state = getAudioPlayerInteractionState({
      audioBytes: new Uint8Array([1]),
      transcript: 'hello',
      isCreator: false,
      slot: { kind: 'none' },
    });

    expect(state.captionsButtonDisabled).toBe(false);
    expect(state.isCaptionsLoading).toBe(false);
  });
});
