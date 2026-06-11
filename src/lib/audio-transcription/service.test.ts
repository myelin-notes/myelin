import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAudioTranscription } from './service';

type EventCallback = (event: { payload: unknown }) => void;
type FakeProcessor = {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

const invokeMock = vi.hoisted(() => vi.fn());
const listeners = vi.hoisted(() => new Map<string, Set<EventCallback>>());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, callback: EventCallback) => {
    const callbacks = listeners.get(eventName) ?? new Set<EventCallback>();
    callbacks.add(callback);
    listeners.set(eventName, callbacks);
    return () => {
      callbacks.delete(callback);
    };
  }),
}));

function emit(eventName: string, payload: unknown): void {
  for (const callback of listeners.get(eventName) ?? []) {
    callback({ payload });
  }
}

describe('audio transcription service', () => {
  let processor: FakeProcessor | null = null;
  let audioContext: FakeAudioContext | null = null;

  class FakeAudioContext {
    public sampleRate = 32_000;
    public destination = {};
    public createMediaStreamSource = vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }));
    public createScriptProcessor = vi.fn(() => {
      processor = {
        onaudioprocess: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      return processor;
    });
    public createGain = vi.fn(() => ({
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }));
    public resume = vi.fn(async () => {});
    public close = vi.fn(async () => {});

    public constructor() {
      audioContext = this;
    }
  }

  afterEach(() => {
    invokeMock.mockReset();
    listeners.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    processor = null;
    audioContext = null;
  });

  it('streams samples and logs matching transcript segments', async () => {
    vi.stubGlobal(
      'AudioContext',
      FakeAudioContext as unknown as typeof AudioContext,
    );
    invokeMock.mockImplementation(async (command: string) =>
      command === 'start_audio_transcription' ? 'session-1' : undefined,
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const session = await startAudioTranscription({
      elementId: 'audio-1',
      mimeType: 'audio/webm',
      stream: {} as MediaStream,
    });

    expect(session).not.toBeNull();
    emit('audio-transcription-segment', {
      sessionId: 'other-session',
      elementId: 'audio-1',
      text: 'ignored',
      startSeconds: 0,
      endSeconds: 1,
      languageCode: 'en',
    });
    emit('audio-transcription-segment', {
      sessionId: 'session-1',
      elementId: 'audio-1',
      text: 'hello world',
      startSeconds: 0,
      endSeconds: 1,
      languageCode: 'en',
    });

    processor?.onaudioprocess?.({
      inputBuffer: {
        length: 3,
        numberOfChannels: 2,
        getChannelData: (channel: number) =>
          channel === 0
            ? new Float32Array([0, 0.5, 1])
            : new Float32Array([1, -0.5, -1]),
      },
    } as unknown as AudioProcessingEvent);

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'push_audio_transcription_samples',
        {
          sessionId: 'session-1',
          samples: [0.5, 0, 0],
          sampleRate: 32_000,
        },
      );
    });
    await session!.finish();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      '[AudioTranscription]',
      'hello world',
      expect.objectContaining({ text: 'hello world' }),
    );
    expect(invokeMock).toHaveBeenCalledWith('finish_audio_transcription', {
      sessionId: 'session-1',
    });
    expect(audioContext?.close).toHaveBeenCalled();
  });
});
