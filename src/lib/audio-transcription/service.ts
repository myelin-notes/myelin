import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Logger } from '@/lib/logger';

const logger = new Logger('AudioTranscription');

const SEGMENT_EVENT = 'audio-transcription-segment';
const FINISHED_EVENT = 'audio-transcription-finished';

interface AudioTranscriptionSegmentPayload {
  sessionId: string;
  elementId: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  languageCode: string;
}

interface AudioTranscriptionFinishedPayload {
  sessionId: string;
  elementId: string;
  error: string | null;
}

interface StartAudioTranscriptionOptions {
  elementId: string;
  mimeType: string;
  stream: MediaStream;
}

export interface AudioTranscriptionSession {
  finish(): Promise<void>;
}

interface PcmCapture {
  stop(): Promise<void>;
}

export async function startAudioTranscription({
  elementId,
  mimeType,
  stream,
}: StartAudioTranscriptionOptions): Promise<AudioTranscriptionSession | null> {
  let sessionId: string | null = null;
  let session: TauriAudioTranscriptionSession | null = null;
  try {
    sessionId = await invoke<string>('start_audio_transcription', {
      elementId,
      mimeType,
    });
    session = new TauriAudioTranscriptionSession(sessionId, elementId);
    await session.startListening();
    await session.startCapture(stream);
    return session;
  } catch (error) {
    if (session) {
      await session.finish();
    } else if (sessionId) {
      await invoke('finish_audio_transcription', { sessionId }).catch(() => {});
    }
    logger.warn('Live audio transcription unavailable', error, { elementId });
    return null;
  }
}

class TauriAudioTranscriptionSession implements AudioTranscriptionSession {
  private unlistenSegment: UnlistenFn | null = null;
  private unlistenFinished: UnlistenFn | null = null;
  private capture: PcmCapture | null = null;
  private sampleSendQueue: Promise<void> = Promise.resolve();
  private acceptsSamples = true;
  private closed = false;
  private finishRequested = false;

  public constructor(
    private readonly sessionId: string,
    private readonly elementId: string,
  ) {}

  public async startListening(): Promise<void> {
    const [unlistenSegment, unlistenFinished] = await Promise.all([
      listen<AudioTranscriptionSegmentPayload>(SEGMENT_EVENT, (event) => {
        if (event.payload.sessionId !== this.sessionId) {
          return;
        }
        console.log('[AudioTranscription]', event.payload.text, event.payload);
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

  public async finish(): Promise<void> {
    if (this.finishRequested) {
      return;
    }
    this.finishRequested = true;
    this.acceptsSamples = false;
    await this.stopCapture();
    await this.sampleSendQueue;

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
  }

  private enqueueSamples(samples: Float32Array, sampleRate: number): void {
    if (this.closed || this.finishRequested || !this.acceptsSamples) {
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
    if (this.closed || this.finishRequested || !this.acceptsSamples) {
      return;
    }

    try {
      await invoke('push_audio_transcription_samples', {
        sessionId: this.sessionId,
        samples: Array.from(samples),
        sampleRate,
      });
    } catch (error) {
      if (this.closed || this.finishRequested) {
        return;
      }
      this.acceptsSamples = false;
      await this.stopCapture();
      if (isClosedSessionError(error)) {
        logger.debug('Live audio transcription sample stream closed', {
          elementId: this.elementId,
          error: String(error),
        });
        return;
      }
      logger.warn('Failed to stream audio samples for transcription', error, {
        elementId: this.elementId,
      });
    }
  }

  private async close(): Promise<void> {
    this.closed = true;
    this.acceptsSamples = false;
    await this.stopCapture();
    this.unlistenSegment?.();
    this.unlistenFinished?.();
    this.unlistenSegment = null;
    this.unlistenFinished = null;
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
  const AudioContextCtor =
    globalThis.AudioContext ??
    (
      globalThis as typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('AudioContext unavailable');
  }

  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const mute = audioContext.createGain();

  mute.gain.value = 0;
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer;
    const frames = input.length;
    const channels = input.numberOfChannels;
    const mono = new Float32Array(frames);

    for (let channel = 0; channel < channels; channel++) {
      const data = input.getChannelData(channel);
      for (let i = 0; i < frames; i++) {
        mono[i] += data[i] / channels;
      }
    }

    onSamples(mono, audioContext.sampleRate);
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

function isClosedSessionError(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes('audio transcription session closed') ||
    message.includes('audio transcription session not found')
  );
}
