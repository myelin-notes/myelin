import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Logger } from '@/lib/logger';

const logger = new Logger('AudioTranscription');

const SEGMENT_EVENT = 'audio-transcription-segment';
const FINISHED_EVENT = 'audio-transcription-finished';

/** Decoded file samples are pushed in chunks to bound per-invoke payload size. */
const IMPORT_CHUNK_SAMPLES = 65_536;

/**
 * After the finish invoke resolves we wait this long for the backend's FINISHED
 * event before settling finish() ourselves — a crashed worker or dropped IPC
 * channel can swallow FINISHED, and callers must never hang on it.
 */
const FINISH_FALLBACK_TIMEOUT_MS = 5_000;

interface AudioTranscriptionSegmentPayload {
  sessionId: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  languageCode: string;
}

interface AudioTranscriptionFinishedPayload {
  sessionId: string;
  error: string | null;
}

interface StartAudioTranscriptionOptions {
  elementId: string;
  stream: MediaStream;
}

export interface AudioTranscriptionSession {
  /** Resolves with the full transcript once the backend flushes its final segments. */
  finish(): Promise<string>;
}

interface PcmCapture {
  stop(): Promise<void>;
}

export async function startAudioTranscription({
  elementId,
  stream,
}: StartAudioTranscriptionOptions): Promise<AudioTranscriptionSession | null> {
  return openSession(elementId, stream);
}

/** Transcribe an already-decoded audio file (the media import path). */
export async function transcribeAudioBuffer(
  elementId: string,
  buffer: AudioBuffer,
): Promise<string | null> {
  const session = await openSession(elementId);
  if (!session) {
    return null;
  }

  session.transcribeSamples(mixToMono(buffer), buffer.sampleRate);
  return session.finish();
}

/** Start a backend session, fully unwinding it (and returning null) on failure. */
async function openSession(
  elementId: string,
  stream?: MediaStream,
): Promise<TauriAudioTranscriptionSession | null> {
  const session = new TauriAudioTranscriptionSession(
    crypto.randomUUID(),
    elementId,
  );
  try {
    // Listen before invoking so a fast-failing worker can't emit FINISHED
    // before any listener exists.
    await session.startListening();
    await invoke('start_audio_transcription', {
      sessionId: session.sessionId,
    });
    if (stream) {
      await session.startCapture(stream);
    }
    return session;
  } catch (error) {
    void invoke('finish_audio_transcription', {
      sessionId: session.sessionId,
    }).catch(() => {});
    await session.close();
    logger.warn('Audio transcription unavailable', error, { elementId });
    return null;
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < buffer.length; i++) {
      mono[i] += data[i] / channels;
    }
  }
  return mono;
}

class TauriAudioTranscriptionSession implements AudioTranscriptionSession {
  private unlistenSegment: UnlistenFn | null = null;
  private unlistenFinished: UnlistenFn | null = null;
  private capture: PcmCapture | null = null;
  private sampleSendQueue: Promise<void> = Promise.resolve();
  private stopped = false;
  private finishPromise: Promise<string> | null = null;
  private readonly segments: string[] = [];
  private resolveClosed!: () => void;
  private readonly closedPromise = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });

  public constructor(
    public readonly sessionId: string,
    private readonly elementId: string,
  ) {}

  public async startListening(): Promise<void> {
    const [unlistenSegment, unlistenFinished] = await Promise.all([
      listen<AudioTranscriptionSegmentPayload>(SEGMENT_EVENT, (event) => {
        if (event.payload.sessionId !== this.sessionId) {
          return;
        }
        this.segments.push(event.payload.text);
      }),
      listen<AudioTranscriptionFinishedPayload>(FINISHED_EVENT, (event) => {
        if (event.payload.sessionId !== this.sessionId) {
          return;
        }
        if (event.payload.error) {
          logger.warn('Live audio transcription stopped', {
            elementId: this.elementId,
            error: event.payload.error,
          });
        }
        void this.close();
      }),
    ]);
    this.unlistenSegment = unlistenSegment;
    this.unlistenFinished = unlistenFinished;
  }

  public async startCapture(stream: MediaStream): Promise<void> {
    this.capture = await startPcmCapture(stream, (samples, sampleRate) => {
      this.enqueueSamples(samples, sampleRate);
    });
  }

  public finish(): Promise<string> {
    this.finishPromise ??= this.doFinish();
    return this.finishPromise;
  }

  private async doFinish(): Promise<string> {
    // Stop capture first so nothing new is enqueued, then drain the backlog
    // before refusing samples — the import path enqueues the whole file and
    // finishes immediately.
    await this.stopCapture();
    await this.sampleSendQueue;
    this.stopped = true;

    try {
      await invoke('finish_audio_transcription', {
        sessionId: this.sessionId,
      });
    } catch (error) {
      await this.close();
      logger.warn('Failed to finish live audio transcription', error, {
        elementId: this.elementId,
      });
    }

    // The backend emits FINISHED after flushing its final segments; the
    // FINISHED handler calls close(), which resolves this promise. If FINISHED
    // never arrives (crashed worker, dropped IPC channel), fall back to
    // close() after a bounded wait so finish() always settles.
    await this.waitForClose();
    return this.segments
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(' ');
  }

  private async waitForClose(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        void this.close();
        resolve();
      }, FINISH_FALLBACK_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.closedPromise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Feed a fully-decoded mono buffer (the file-import path) in bounded chunks
   * so no single invoke payload grows unboundedly.
   */
  public transcribeSamples(mono: Float32Array, sampleRate: number): void {
    for (let offset = 0; offset < mono.length; offset += IMPORT_CHUNK_SAMPLES) {
      this.enqueueSamples(
        mono.subarray(offset, offset + IMPORT_CHUNK_SAMPLES),
        sampleRate,
      );
    }
  }

  private enqueueSamples(samples: Float32Array, sampleRate: number): void {
    if (this.stopped) {
      return;
    }

    this.sampleSendQueue = this.sampleSendQueue.then(() =>
      this.pushSamples(samples, sampleRate),
    );
  }

  private async pushSamples(
    samples: Float32Array,
    sampleRate: number,
  ): Promise<void> {
    // Re-checked at execution time: the queue can hold a backlog spanning
    // invoke round-trips during which close() or a push failure may have run.
    if (this.stopped) {
      return;
    }

    try {
      const accepted = await invoke<boolean>(
        'push_audio_transcription_samples',
        new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
        {
          headers: {
            'x-session-id': this.sessionId,
            'x-sample-rate': String(sampleRate),
          },
        },
      );
      if (!accepted && !this.stopped) {
        this.stopped = true;
        await this.stopCapture();
        logger.debug('Live audio transcription sample stream closed', {
          elementId: this.elementId,
        });
      }
    } catch (error) {
      if (this.stopped) {
        return;
      }
      this.stopped = true;
      await this.stopCapture();
      logger.warn('Failed to stream audio samples for transcription', error, {
        elementId: this.elementId,
      });
    }
  }

  public async close(): Promise<void> {
    this.stopped = true;
    await this.stopCapture();
    this.unlistenSegment?.();
    this.unlistenFinished?.();
    this.unlistenSegment = null;
    this.unlistenFinished = null;
    this.resolveClosed();
  }

  private async stopCapture(): Promise<void> {
    const capture = this.capture;
    this.capture = null;
    try {
      await capture?.stop();
    } catch (error) {
      logger.warn('Failed to stop audio transcription capture', error, {
        elementId: this.elementId,
      });
    }
  }
}

async function startPcmCapture(
  stream: MediaStream,
  onSamples: (samples: Float32Array, sampleRate: number) => void,
): Promise<PcmCapture> {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  // Deliberately the deprecated ScriptProcessorNode over AudioWorklet: a
  // worklet module needs bundler plumbing and per-webview verification
  // (AudioWorklet support in WebKitGTK is unconfirmed). Worst case here is
  // main-thread starvation dropping samples, which degrades the live
  // transcript — the recording itself comes from MediaRecorder and is
  // unaffected, and the transcribe button can regenerate the transcript.
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const mute = audioContext.createGain();

  mute.gain.value = 0;
  processor.onaudioprocess = (event) => {
    onSamples(mixToMono(event.inputBuffer), audioContext.sampleRate);
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);
  await audioContext.resume();

  return {
    async stop() {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      await audioContext.close();
    },
  };
}
