import { trackEvent } from '@myelin/shared/analytics';
import { Logger } from '@myelin/shared/logger';
import { getPlatform } from '../../platform';
import type {
  AudioTranscriptionSession,
  TranscriptSegment,
} from '../../platform/types';
import type { PeerMode } from '../../sync/live/peers';
import { segmentsToText } from './segments';
import { shouldClaimOnRecordingStart } from './transcription-claims';
import { decodeAudio } from './waveform';

const logger = new Logger('AudioRecording');

export type AudioRecordingState =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'processing';

export interface AudioRecordingStatus {
  state: AudioRecordingState;
  isTranscribing: boolean;
}

export interface AudioRecordingListener {
  onStatusChange: (status: AudioRecordingStatus) => void;
  onNoSpeech?: () => void;
}

export interface AudioRecordingTarget {
  onRecorded: (
    data: Uint8Array,
    duration: number,
    mimeType: string,
    waveform: Float32Array | null,
  ) => void;
  onRecordingSaved?: () => void | Promise<void>;
  onTranscribed: (segments: TranscriptSegment[]) => void;
  onTranscriptionClaimed: () => void;
  onTranscriptionClaimReleased: () => void;
}

interface ActiveAudioRecording {
  elementId: string;
  ownerId: string;
  localMode: PeerMode;
  target: AudioRecordingTarget;
  state: AudioRecordingState;
  isTranscribing: boolean;
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
  transcription: AudioTranscriptionSession | null;
  chunks: Blob[];
  startedAt: number;
  stopRequested: boolean;
  discardRequested: boolean;
  claimed: boolean;
  abortController: AbortController;
  completionPromise: Promise<void>;
  resolveCompletion: () => void;
}

const recordings = new Map<string, ActiveAudioRecording>();
const listeners = new Map<string, Set<AudioRecordingListener>>();

function statusFor(
  entry: ActiveAudioRecording | undefined,
): AudioRecordingStatus {
  return {
    state: entry?.state ?? 'idle',
    isTranscribing: entry?.isTranscribing ?? false,
  };
}

function notifyStatus(entry: ActiveAudioRecording): void {
  if (recordings.get(entry.elementId) !== entry) {
    return;
  }
  const status = statusFor(entry);
  for (const listener of listeners.get(entry.elementId) ?? []) {
    listener.onStatusChange(status);
  }
}

function notifyNoSpeech(entry: ActiveAudioRecording): void {
  if (recordings.get(entry.elementId) !== entry) {
    return;
  }
  for (const listener of listeners.get(entry.elementId) ?? []) {
    listener.onNoSpeech?.();
  }
}

function completeRecording(entry: ActiveAudioRecording): void {
  if (recordings.get(entry.elementId) === entry) {
    recordings.delete(entry.elementId);
  }
  entry.resolveCompletion();
}

function stopStream(entry: ActiveAudioRecording): void {
  entry.stream?.getTracks().forEach((track) => {
    track.stop();
  });
  entry.stream = null;
}

function releaseTranscriptionClaim(entry: ActiveAudioRecording): void {
  if (!entry.claimed) {
    return;
  }
  entry.claimed = false;
  entry.target.onTranscriptionClaimReleased();
}

async function cancelTranscription(entry: ActiveAudioRecording): Promise<void> {
  try {
    await entry.transcription?.cancel();
  } catch (error) {
    logger.error('Failed to cancel audio transcription', error, {
      elementId: entry.elementId,
    });
  }
}

async function saveRecording(entry: ActiveAudioRecording): Promise<void> {
  try {
    await entry.target.onRecordingSaved?.();
  } catch (error) {
    logger.error('Failed to save audio recording', error, {
      elementId: entry.elementId,
    });
  }
}

async function finalizeRecording(
  entry: ActiveAudioRecording,
  recorder: MediaRecorder,
): Promise<void> {
  const elapsedSeconds = Math.max(0, (Date.now() - entry.startedAt) / 1000);
  const transcription = entry.transcription;
  const transcriptPromise =
    transcription?.finish() ?? Promise.resolve<TranscriptSegment[]>([]);

  if (entry.chunks.length === 0) {
    await cancelTranscription(entry);
    releaseTranscriptionClaim(entry);
    await saveRecording(entry);
    return;
  }

  const blob = new Blob(entry.chunks, { type: recorder.mimeType });
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let duration = 0;
  let waveform: Float32Array | null = null;
  try {
    const decoded = await decodeAudio(bytes);
    duration = decoded.duration;
    waveform = decoded.waveform;
  } catch {
    duration = elapsedSeconds;
    // An instant start/stop can produce a header-only blob no decoder accepts.
    if (duration < 1) {
      await cancelTranscription(entry);
      releaseTranscriptionClaim(entry);
      await saveRecording(entry);
      return;
    }
  }

  if (entry.abortController.signal.aborted) {
    return;
  }

  entry.target.onRecorded(bytes, duration, recorder.mimeType, waveform);
  entry.state = 'idle';
  notifyStatus(entry);
  await saveRecording(entry);

  if (!transcription) {
    return;
  }

  const transcribed = await transcriptPromise.catch(
    (): TranscriptSegment[] => [],
  );
  if (entry.abortController.signal.aborted) {
    return;
  }

  trackEvent('transcription_completed', {
    duration_seconds: Math.round(duration),
    transcript_length: segmentsToText(transcribed).length,
    had_speech: transcribed.length > 0,
  });
  if (transcribed.length > 0) {
    entry.target.onTranscribed(transcribed);
    entry.claimed = false;
  } else {
    releaseTranscriptionClaim(entry);
    notifyNoSpeech(entry);
  }
  await saveRecording(entry);
}

async function initializeRecording(
  entry: ActiveAudioRecording,
): Promise<boolean> {
  let stream: MediaStream | null = null;
  try {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      throw new Error('Audio recording is unavailable.');
    }

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (entry.stopRequested) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      return false;
    }
    entry.stream = stream;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    const transcription =
      (await getPlatform().transcription?.startSession({
        elementId: entry.elementId,
        stream,
      })) ?? null;
    entry.transcription = transcription;

    if (entry.stopRequested) {
      await cancelTranscription(entry);
      stopStream(entry);
      return false;
    }

    if (
      shouldClaimOnRecordingStart({
        transcriptionSessionStarted: transcription !== null,
        localMode: entry.localMode,
      })
    ) {
      entry.claimed = true;
      entry.target.onTranscriptionClaimed();
    }

    entry.recorder = recorder;
    entry.startedAt = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        entry.chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      stopStream(entry);
      if (entry.discardRequested) {
        entry.state = 'idle';
        entry.isTranscribing = false;
        notifyStatus(entry);
        void cancelTranscription(entry).finally(() => {
          completeRecording(entry);
        });
        return;
      }

      entry.state = 'processing';
      entry.isTranscribing = transcription !== null;
      notifyStatus(entry);
      void finalizeRecording(entry, recorder)
        .catch(async (error) => {
          logger.error('Failed to finalize audio recording', error, {
            elementId: entry.elementId,
          });
          await cancelTranscription(entry);
          releaseTranscriptionClaim(entry);
          await saveRecording(entry);
        })
        .finally(() => {
          const statusChanged = entry.state !== 'idle' || entry.isTranscribing;
          entry.state = 'idle';
          entry.isTranscribing = false;
          if (statusChanged) {
            notifyStatus(entry);
          }
          completeRecording(entry);
        });
    };

    recorder.start(100);
    transcription?.markRecordingStart();
    entry.state = 'recording';
    notifyStatus(entry);
    return true;
  } catch (error) {
    stopStream(entry);
    await cancelTranscription(entry);
    releaseTranscriptionClaim(entry);
    logger.error('Failed to start audio recording', error, {
      elementId: entry.elementId,
    });
    return false;
  }
}

export async function startAudioRecording(
  elementId: string,
  ownerId: string,
  localMode: PeerMode,
  target: AudioRecordingTarget,
): Promise<boolean> {
  if (recordings.has(elementId)) {
    return false;
  }

  let resolveCompletion!: () => void;
  const completionPromise = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const entry: ActiveAudioRecording = {
    elementId,
    ownerId,
    localMode,
    target,
    state: 'requesting',
    isTranscribing: false,
    recorder: null,
    stream: null,
    transcription: null,
    chunks: [],
    startedAt: 0,
    stopRequested: false,
    discardRequested: false,
    claimed: false,
    abortController: new AbortController(),
    completionPromise,
    resolveCompletion,
  };
  recordings.set(elementId, entry);
  notifyStatus(entry);
  const started = await initializeRecording(entry);
  if (!started) {
    entry.state = 'idle';
    notifyStatus(entry);
    completeRecording(entry);
  }
  return started;
}

export function getAudioRecordingStatus(
  elementId: string,
): AudioRecordingStatus {
  return statusFor(recordings.get(elementId));
}

export function getAudioRecordingState(elementId: string): AudioRecordingState {
  return getAudioRecordingStatus(elementId).state;
}

export function getAudioRecordingElapsedSeconds(elementId: string): number {
  const entry = recordings.get(elementId);
  return entry?.startedAt
    ? Math.max(0, (Date.now() - entry.startedAt) / 1000)
    : 0;
}

export function hasAudioRecordingsForOwner(ownerId: string): boolean {
  return Array.from(recordings.values()).some(
    (entry) => entry.ownerId === ownerId,
  );
}

export function attachAudioRecording(
  elementId: string,
  listener: AudioRecordingListener,
): () => void {
  let elementListeners = listeners.get(elementId);
  if (!elementListeners) {
    elementListeners = new Set();
    listeners.set(elementId, elementListeners);
  }
  elementListeners.add(listener);
  listener.onStatusChange(getAudioRecordingStatus(elementId));

  return () => {
    elementListeners.delete(listener);
    if (
      elementListeners.size === 0 &&
      listeners.get(elementId) === elementListeners
    ) {
      listeners.delete(elementId);
    }
  };
}

export function stopAudioRecording(elementId: string): Promise<void> | null {
  const entry = recordings.get(elementId);
  if (!entry) {
    return null;
  }

  entry.stopRequested = true;
  const recorder = entry.recorder;
  if (recorder && recorder.state !== 'inactive') {
    entry.state = 'processing';
    notifyStatus(entry);
    recorder.stop();
  } else if (!recorder) {
    stopStream(entry);
    entry.state = 'idle';
    notifyStatus(entry);
    completeRecording(entry);
  }
  return entry.completionPromise;
}

export function discardAudioRecording(elementId: string): Promise<void> | null {
  const entry = recordings.get(elementId);
  if (!entry) {
    return null;
  }

  entry.stopRequested = true;
  entry.discardRequested = true;
  entry.abortController.abort();
  releaseTranscriptionClaim(entry);

  const recorder = entry.recorder;
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  } else if (!recorder) {
    stopStream(entry);
    entry.state = 'idle';
    notifyStatus(entry);
    completeRecording(entry);
  } else {
    void cancelTranscription(entry);
  }
  return entry.completionPromise;
}

export function waitForAudioRecordingsForOwner(
  ownerId: string,
): Promise<void> | null {
  const pending = Array.from(recordings.values())
    .filter((entry) => entry.ownerId === ownerId)
    .map((entry) => entry.completionPromise);
  return pending.length > 0 ? Promise.all(pending).then(() => undefined) : null;
}

export function stopAudioRecordingsForOwner(
  ownerId: string,
): Promise<void> | null {
  const pending = Array.from(recordings.values())
    .filter((entry) => entry.ownerId === ownerId)
    .map((entry) => stopAudioRecording(entry.elementId));
  const promises = pending.filter(
    (promise): promise is Promise<void> => promise !== null,
  );
  return promises.length > 0
    ? Promise.all(promises).then(() => undefined)
    : null;
}

export function stopAllAudioRecordings(): Promise<void> | null {
  const pending = Array.from(recordings.keys()).map((elementId) =>
    stopAudioRecording(elementId),
  );
  const promises = pending.filter(
    (promise): promise is Promise<void> => promise !== null,
  );
  return promises.length > 0
    ? Promise.all(promises).then(() => undefined)
    : null;
}
