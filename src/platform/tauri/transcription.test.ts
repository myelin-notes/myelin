import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcription } from './transcription';

type EventCallback = (event: { payload: unknown }) => void;
type FakeWorkletNode = {
  port: { onmessage: ((event: MessageEvent<Float32Array>) => void) | null };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

const invokeMock = vi.hoisted(() => vi.fn());
const listeners = vi.hoisted(() => new Map<string, Set<EventCallback>>());
const loggerDebug = vi.hoisted(() => vi.fn());
const loggerWarn = vi.hoisted(() => vi.fn());
const loggerError = vi.hoisted(() => vi.fn());

vi.mock('./pcm-capture.worklet.ts?worker&url', () => ({
  default: 'pcm-capture.worklet.js',
}));

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

vi.mock('@myelin/shared/logger', () => ({
  Logger: class {
    debug = loggerDebug;
    info = vi.fn();
    warn = loggerWarn;
    error = loggerError;
  },
}));

function emit(eventName: string, payload: unknown): void {
  for (const callback of listeners.get(eventName) ?? []) {
    callback({ payload });
  }
}

function listenerCount(): number {
  let count = 0;
  for (const callbacks of listeners.values()) {
    count += callbacks.size;
  }
  return count;
}

function invokesOf(command: string): unknown[][] {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === command);
}

function startedSessionId(): string {
  const [, args] = invokesOf('start_audio_transcription')[0];
  return (args as { sessionId: string }).sessionId;
}

function emitSegment(sessionId: string, text: string): void {
  emit('audio-transcription-segment', {
    sessionId,
    text,
    startSeconds: 0,
    endSeconds: 1,
    languageCode: 'en',
  });
}

function emitFinished(sessionId: string, error: string | null = null): void {
  emit('audio-transcription-finished', {
    sessionId,
    error,
  });
}

describe('audio transcription service', () => {
  let workletNode: FakeWorkletNode | null = null;
  let audioContext: FakeAudioContext | null = null;

  class FakeAudioContext {
    public sampleRate = 32_000;
    public destination = {};
    public audioWorklet = { addModule: vi.fn(async () => {}) };
    public createMediaStreamSource = vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }));
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

  class FakeAudioWorkletNode {
    public port: FakeWorkletNode['port'] = { onmessage: null };
    public connect = vi.fn();
    public disconnect = vi.fn();

    public constructor() {
      workletNode = this;
    }
  }

  function stubAudioContext(
    Ctor: typeof FakeAudioContext = FakeAudioContext,
  ): void {
    vi.stubGlobal('AudioContext', Ctor as unknown as typeof AudioContext);
    vi.stubGlobal(
      'AudioWorkletNode',
      FakeAudioWorkletNode as unknown as typeof AudioWorkletNode,
    );
  }

  function mockInvokeDefaults(): void {
    invokeMock.mockImplementation(async (command: string) =>
      command === 'push_audio_transcription_samples' ? true : undefined,
    );
  }

  async function start() {
    return transcription.startSession({
      elementId: 'audio-1',
      stream: {} as MediaStream,
    });
  }

  function emitSamples(): void {
    workletNode?.port.onmessage?.({
      data: new Float32Array([0.5, 0, 0]),
    } as MessageEvent<Float32Array>);
  }

  afterEach(() => {
    invokeMock.mockReset();
    loggerDebug.mockReset();
    loggerWarn.mockReset();
    loggerError.mockReset();
    listeners.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    workletNode = null;
    audioContext = null;
  });

  it('streams raw PCM and resolves the accumulated transcript on finish', async () => {
    stubAudioContext();
    mockInvokeDefaults();

    const session = await start();
    expect(session).not.toBeNull();
    const sessionId = startedSessionId();

    emitSegment('other-session', 'ignored');
    emitSegment(sessionId, ' hello');
    emitSegment(sessionId, 'world ');

    emitSamples();
    await vi.waitFor(() => {
      expect(invokesOf('push_audio_transcription_samples')).toHaveLength(1);
    });
    const [, payload, options] = invokesOf(
      'push_audio_transcription_samples',
    )[0];
    expect(payload).toBeInstanceOf(Uint8Array);
    const bytes = payload as Uint8Array;
    const samples = Array.from(
      new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4),
    );
    expect(samples).toEqual([0.5, 0, 0]);
    expect(options).toEqual({
      headers: { 'x-session-id': sessionId, 'x-sample-rate': '32000' },
    });

    const finishPromise = session!.finish();
    await vi.waitFor(() => {
      expect(invokesOf('finish_audio_transcription')).toHaveLength(1);
    });
    emitFinished(sessionId);

    expect(await finishPromise).toBe('hello world');
    expect(audioContext?.close).toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
  });

  it('returns null and removes listeners when the start invoke rejects', async () => {
    stubAudioContext();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'start_audio_transcription') {
        throw new Error('model missing');
      }
      return undefined;
    });

    const session = await start();

    expect(session).toBeNull();
    expect(listenerCount()).toBe(0);
    expect(loggerError).toHaveBeenCalled();
  });

  it('finishes the backend session and removes listeners when capture fails', async () => {
    class BrokenAudioContext extends FakeAudioContext {
      public override resume = vi.fn(async () => {
        throw new Error('no audio');
      });
    }
    stubAudioContext(BrokenAudioContext);
    mockInvokeDefaults();

    const session = await start();

    expect(session).toBeNull();
    expect(invokesOf('finish_audio_transcription')).toHaveLength(1);
    const [, args] = invokesOf('finish_audio_transcription')[0];
    expect(args).toEqual({ sessionId: startedSessionId() });
    expect(listenerCount()).toBe(0);
  });

  it('closes on a backend FINISHED event and stops pushing samples', async () => {
    stubAudioContext();
    mockInvokeDefaults();

    await start();
    emitFinished(startedSessionId(), 'worker exploded');

    await vi.waitFor(() => {
      expect(audioContext?.close).toHaveBeenCalled();
      expect(listenerCount()).toBe(0);
    });
    expect(loggerError).toHaveBeenCalled();

    emitSamples();
    await Promise.resolve();
    expect(invokesOf('push_audio_transcription_samples')).toHaveLength(0);
  });

  it('invokes finish exactly once when finish is called twice', async () => {
    stubAudioContext();
    mockInvokeDefaults();

    const session = await start();
    const first = session!.finish();
    const second = session!.finish();
    await vi.waitFor(() => {
      expect(invokesOf('finish_audio_transcription')).toHaveLength(1);
    });
    emitFinished(startedSessionId());
    await Promise.all([first, second]);

    expect(invokesOf('finish_audio_transcription')).toHaveLength(1);
  });

  it('stops capture without warning when the backend reports the session gone', async () => {
    stubAudioContext();
    invokeMock.mockImplementation(async (command: string) =>
      command === 'push_audio_transcription_samples' ? false : undefined,
    );

    await start();
    emitSamples();

    await vi.waitFor(() => {
      expect(audioContext?.close).toHaveBeenCalled();
    });
    expect(loggerDebug).toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();

    emitSamples();
    await Promise.resolve();
    expect(invokesOf('push_audio_transcription_samples')).toHaveLength(1);
  });

  it('stops capture and warns when a sample push fails', async () => {
    stubAudioContext();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'push_audio_transcription_samples') {
        throw new Error('ipc exploded');
      }
      return undefined;
    });

    await start();
    emitSamples();

    await vi.waitFor(() => {
      expect(audioContext?.close).toHaveBeenCalled();
    });
    expect(loggerError).toHaveBeenCalled();

    emitSamples();
    await Promise.resolve();
    expect(invokesOf('push_audio_transcription_samples')).toHaveLength(1);
  });

  it('drops samples emitted after finish resolves', async () => {
    stubAudioContext();
    mockInvokeDefaults();

    const session = await start();
    const finishPromise = session!.finish();
    await vi.waitFor(() => {
      expect(invokesOf('finish_audio_transcription')).toHaveLength(1);
    });
    emitFinished(startedSessionId());
    await finishPromise;

    emitSamples();
    await Promise.resolve();
    expect(invokesOf('push_audio_transcription_samples')).toHaveLength(0);
  });

  it('keeps finish() pending until FINISHED arrives, however late', async () => {
    vi.useFakeTimers();
    try {
      stubAudioContext();
      mockInvokeDefaults();

      const session = await start();
      const sessionId = startedSessionId();
      emitSegment(sessionId, ' slow transcript ');

      let settled = false;
      const finishPromise = session!.finish().then((transcript) => {
        settled = true;
        return transcript;
      });

      // Let the finish invoke resolve, but delay FINISHED far beyond the old
      // 5s fallback: a slow whisper run is not a failure.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(invokesOf('finish_audio_transcription')).toHaveLength(1);
      expect(settled).toBe(false);

      emitFinished(sessionId);
      expect(await finishPromise).toBe('slow transcript');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() aborts the backend session and settles a pending finish()', async () => {
    stubAudioContext();
    mockInvokeDefaults();

    const session = await start();
    const sessionId = startedSessionId();
    const finishPromise = session!.finish();
    await vi.waitFor(() => {
      expect(invokesOf('finish_audio_transcription')).toHaveLength(1);
    });

    await session!.cancel();

    expect(invokesOf('cancel_audio_transcription')).toEqual([
      ['cancel_audio_transcription', { sessionId }],
    ]);
    await finishPromise;
    expect(audioContext?.close).toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
  });

  it('transcribes a decoded audio buffer in chunks', async () => {
    mockInvokeDefaults();
    const length = 70_000;
    const data = new Float32Array(length).fill(0.25);
    const buffer = {
      length,
      numberOfChannels: 1,
      sampleRate: 44_100,
      getChannelData: () => data,
    } as unknown as AudioBuffer;

    const session = await transcription.startBufferSession('audio-1', buffer);
    expect(session).not.toBeNull();
    const transcriptPromise = session!.finish();

    await vi.waitFor(() => {
      expect(invokesOf('push_audio_transcription_samples')).toHaveLength(2);
    });
    const chunkLengths = invokesOf('push_audio_transcription_samples').map(
      ([, payload]) => (payload as Uint8Array).byteLength / 4,
    );
    expect(chunkLengths).toEqual([65_536, length - 65_536]);

    const sessionId = startedSessionId();
    emitSegment(sessionId, 'hola mundo');
    emitFinished(sessionId);

    expect(await transcriptPromise).toBe('hola mundo');
    expect(listenerCount()).toBe(0);
  });
});
