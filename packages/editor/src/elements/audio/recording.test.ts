import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '../../platform';
import type { AudioTranscriptionSession } from '../../platform/types';
import { createFakePlatform } from '../../test/fake-platform';
import {
  type AudioRecordingListener,
  type AudioRecordingTarget,
  attachAudioRecording,
  discardAudioRecording,
  getAudioRecordingState,
  startAudioRecording,
  stopAudioRecordingsForOwner,
} from './recording';
import { decodeAudio } from './waveform';

vi.mock('./waveform', () => ({
  decodeAudio: vi.fn(),
}));

class FakeMediaRecorder {
  public static isTypeSupported(): boolean {
    return true;
  }

  public state: 'inactive' | 'recording' = 'inactive';
  public readonly mimeType = 'audio/webm';
  public ondataavailable: ((event: { data: Blob }) => void) | null = null;
  public onstop: (() => void) | null = null;

  public constructor(public readonly stream: MediaStream) {}

  public start(): void {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob(['recorded']) });
  }

  public stop(): void {
    this.state = 'inactive';
    this.onstop?.();
  }
}

function target(): AudioRecordingTarget {
  return {
    onRecorded: vi.fn(),
    onRecordingSaved: vi.fn().mockResolvedValue(undefined),
    onTranscribed: vi.fn(),
    onTranscriptionClaimed: vi.fn(),
    onTranscriptionClaimReleased: vi.fn(),
  };
}

function listener(): AudioRecordingListener {
  return {
    onStatusChange: vi.fn(),
    onNoSpeech: vi.fn(),
  };
}

describe('audio recording lifecycle', () => {
  beforeEach(() => {
    vi.mocked(decodeAudio).mockReset();
    vi.mocked(decodeAudio).mockResolvedValue({
      buffer: {} as AudioBuffer,
      duration: 2,
      waveform: new Float32Array([0.5]),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the recorder alive while views detach and stops it by owner', async () => {
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })),
      },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const firstListener = listener();
    const detach = attachAudioRecording('audio-1', firstListener);
    const recordingTarget = target();
    await expect(
      startAudioRecording('audio-1', 'tab-1', 'owner-device', recordingTarget),
    ).resolves.toBe(true);
    detach();

    const remountedListener = listener();
    attachAudioRecording('audio-1', remountedListener);
    await stopAudioRecordingsForOwner('tab-1');

    expect(recordingTarget.onRecorded).toHaveBeenCalledOnce();
    expect(firstListener.onStatusChange).toHaveBeenLastCalledWith({
      state: 'recording',
      isTranscribing: false,
    });
    expect(remountedListener.onStatusChange).toHaveBeenLastCalledWith({
      state: 'idle',
      isTranscribing: false,
    });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(getAudioRecordingState('audio-1')).toBe('idle');
  });

  it('does not stop a recording owned by another canvas tab', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
      },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const recordingTarget = target();
    await startAudioRecording(
      'audio-1',
      'tab-1',
      'owner-device',
      recordingTarget,
    );
    attachAudioRecording('audio-1', listener());

    expect(stopAudioRecordingsForOwner('tab-2')).toBeNull();
    expect(getAudioRecordingState('audio-1')).toBe('recording');

    await stopAudioRecordingsForOwner('tab-1');
    expect(recordingTarget.onRecorded).toHaveBeenCalledOnce();
  });

  it('reports processing until the recorded audio is ready', async () => {
    let resolveDecode!: (decoded: {
      buffer: AudioBuffer;
      duration: number;
      waveform: Float32Array;
    }) => void;
    vi.mocked(decodeAudio).mockReturnValue(
      new Promise((resolve) => {
        resolveDecode = resolve;
      }),
    );
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
      },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const recordingListener = listener();
    const recordingTarget = target();
    attachAudioRecording('audio-1', recordingListener);
    await startAudioRecording(
      'audio-1',
      'tab-1',
      'owner-device',
      recordingTarget,
    );

    const stopped = stopAudioRecordingsForOwner('tab-1');
    if (!stopped) {
      throw new Error('Expected a pending recording');
    }

    expect(getAudioRecordingState('audio-1')).toBe('processing');
    expect(recordingListener.onStatusChange).toHaveBeenLastCalledWith({
      state: 'processing',
      isTranscribing: false,
    });
    expect(recordingTarget.onRecorded).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(decodeAudio).toHaveBeenCalledOnce());
    resolveDecode({
      buffer: {} as AudioBuffer,
      duration: 2,
      waveform: new Float32Array([0.5]),
    });
    await stopped;

    expect(recordingTarget.onRecorded).toHaveBeenCalledOnce();
    expect(getAudioRecordingState('audio-1')).toBe('idle');
  });

  it('discards a deleted element recording without publishing it', async () => {
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })),
      },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const recordingTarget = target();
    await startAudioRecording(
      'audio-1',
      'tab-1',
      'owner-device',
      recordingTarget,
    );

    await discardAudioRecording('audio-1');

    expect(recordingTarget.onRecorded).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(getAudioRecordingState('audio-1')).toBe('idle');
  });

  it('discards while microphone access is still pending', async () => {
    const track = { stop: vi.fn() };
    let resolveStream!: (stream: { getTracks: () => (typeof track)[] }) => void;
    const stream = new Promise<{ getTracks: () => (typeof track)[] }>(
      (resolve) => {
        resolveStream = resolve;
      },
    );
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(() => stream) },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const recordingTarget = target();
    const start = startAudioRecording(
      'audio-1',
      'tab-1',
      'owner-device',
      recordingTarget,
    );
    await discardAudioRecording('audio-1');
    resolveStream({ getTracks: () => [track] });

    await expect(start).resolves.toBe(false);
    expect(recordingTarget.onRecorded).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(getAudioRecordingState('audio-1')).toBe('idle');
  });

  it('does not let a cancelled permission request overwrite a newer recording', async () => {
    const firstTrack = { stop: vi.fn() };
    let resolveFirstStream!: (stream: {
      getTracks: () => (typeof firstTrack)[];
    }) => void;
    const firstStream = new Promise<{
      getTracks: () => (typeof firstTrack)[];
    }>((resolve) => {
      resolveFirstStream = resolve;
    });
    const getUserMedia = vi
      .fn()
      .mockReturnValueOnce(firstStream)
      .mockResolvedValueOnce({ getTracks: () => [] });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recordingListener = listener();
    attachAudioRecording('audio-1', recordingListener);

    const firstStart = startAudioRecording(
      'audio-1',
      'tab-1',
      'owner-device',
      target(),
    );
    await stopAudioRecordingsForOwner('tab-1');
    await startAudioRecording('audio-1', 'tab-1', 'owner-device', target());
    resolveFirstStream({ getTracks: () => [firstTrack] });
    await firstStart;

    expect(getAudioRecordingState('audio-1')).toBe('recording');
    expect(recordingListener.onStatusChange).toHaveBeenLastCalledWith({
      state: 'recording',
      isTranscribing: false,
    });
    expect(firstTrack.stop).toHaveBeenCalledOnce();

    await discardAudioRecording('audio-1');
  });

  it('saves again after live transcription updates the recording', async () => {
    const transcription: AudioTranscriptionSession = {
      finish: vi.fn(async () => [
        { startSeconds: 0, endSeconds: 1, text: 'hello' },
      ]),
      markRecordingStart: vi.fn(),
      cancel: vi.fn(async () => {}),
    };
    setPlatform(
      createFakePlatform({
        transcription: {
          startSession: vi.fn(async () => transcription),
          startBufferSession: vi.fn(async () => null),
        },
      }),
    );
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
      },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const recordingTarget = target();
    await startAudioRecording(
      'audio-1',
      'tab-1',
      'owner-device',
      recordingTarget,
    );
    await stopAudioRecordingsForOwner('tab-1');

    expect(recordingTarget.onRecorded).toHaveBeenCalledOnce();
    expect(recordingTarget.onTranscribed).toHaveBeenCalledWith([
      { startSeconds: 0, endSeconds: 1, text: 'hello' },
    ]);
    expect(recordingTarget.onRecordingSaved).toHaveBeenCalledTimes(2);
  });

  it('discards an undecodable subsecond recording', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.mocked(decodeAudio).mockRejectedValue(new Error('header only'));
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
      },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const recordingTarget = target();
    await startAudioRecording(
      'audio-1',
      'tab-1',
      'owner-device',
      recordingTarget,
    );
    vi.advanceTimersByTime(500);
    await stopAudioRecordingsForOwner('tab-1');

    expect(recordingTarget.onRecorded).not.toHaveBeenCalled();
  });
});
