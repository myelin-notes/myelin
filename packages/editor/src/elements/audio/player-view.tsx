import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Captions as CaptionsIcon,
  LoaderCircle,
  Mic as MicIcon,
  Pause as PauseIcon,
  Play as PlayIcon,
  Square as SquareIcon,
} from 'lucide-react';
import { trackEvent } from '@myelin/shared/analytics';
import { Logger } from '@myelin/shared/logger';
import { getCanvasPalette, withCanvasAlpha } from '../../canvas-theme';
import { VirtualList } from '../../components/virtual-list';
import { useMessages } from '../../i18n';
import { type AudioTranscriptionSession, getPlatform } from '../../platform';
import type { TranscriptSegment } from '../../platform/types';
import type { LivePeer, PeerMode } from '../../sync/live/peers';
import { getDevicePixelRatio } from '../../utils';
import { activeSegmentIndex, segmentsToText } from './segments';
import {
  canTranscribeHere,
  getTranscriptionSlotState,
  shouldAutoTranscribe,
  shouldClaimOnRecordingStart,
  shouldStartAutoPickup,
  type TranscriptionCoordinationInput,
  type TranscriptionSlotState,
} from './transcription-claims';
import { decodeAudio, drawWaveform } from './waveform';

const logger = new Logger('AudioTranscription');

const MAX_WAVEFORM_BACKING_DIMENSION = 4096;

// TODO: presence carries no device display name yet — add `deviceName` to the
// peer hello/heartbeat so this can show "Caden's MacBook" instead of a UUID.
function formatPeerId(peerId: string): string {
  if (peerId.length <= 12) {
    return peerId;
  }
  return `${peerId.slice(0, 8)}...${peerId.slice(-4)}`;
}

type RecordingState = 'idle' | 'requesting' | 'recording' | 'error';

// Unwrapped row at scale 1: 11px text × 1.5 line-height + 2px padding each side.
const estimateSegmentRowHeight = () => 21;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface WaveformDisplaySize {
  cssWidth: number;
  cssHeight: number;
}

export interface WaveformCanvasMetrics {
  cssWidth: number;
  cssHeight: number;
  pixelRatio: number;
  backingWidth: number;
  backingHeight: number;
}

export function getWaveformCanvasMetrics(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): WaveformCanvasMetrics {
  const safeCssWidth = Math.max(1, cssWidth);
  const safeCssHeight = Math.max(1, cssHeight);
  const pixelRatio = Math.min(
    devicePixelRatio,
    MAX_WAVEFORM_BACKING_DIMENSION / safeCssWidth,
    MAX_WAVEFORM_BACKING_DIMENSION / safeCssHeight,
  );
  return {
    cssWidth: safeCssWidth,
    cssHeight: safeCssHeight,
    pixelRatio,
    backingWidth: Math.max(1, Math.ceil(safeCssWidth * pixelRatio)),
    backingHeight: Math.max(1, Math.ceil(safeCssHeight * pixelRatio)),
  };
}

function getWaveformCanvasDisplaySize(
  canvas: HTMLCanvasElement,
): WaveformDisplaySize {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = rect.width || canvas.clientWidth || canvas.width;
  const cssHeight = rect.height || canvas.clientHeight || canvas.height;
  return { cssWidth, cssHeight };
}

function prepareWaveformCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  displaySize: WaveformDisplaySize | null,
): WaveformCanvasMetrics {
  // The ResizeObserver-cached size avoids a forced-reflow measurement here —
  // this runs every rAF frame while recording.
  const { cssWidth, cssHeight } =
    displaySize ?? getWaveformCanvasDisplaySize(canvas);
  const metrics = getWaveformCanvasMetrics(
    cssWidth,
    cssHeight,
    getDevicePixelRatio(),
  );
  if (
    canvas.width !== metrics.backingWidth ||
    canvas.height !== metrics.backingHeight
  ) {
    canvas.width = metrics.backingWidth;
    canvas.height = metrics.backingHeight;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, metrics.backingWidth, metrics.backingHeight);
  ctx.setTransform(metrics.pixelRatio, 0, 0, metrics.pixelRatio, 0, 0);
  return metrics;
}

function drawRecordingWaveformFrame(
  canvas: HTMLCanvasElement,
  displaySize: WaveformDisplaySize | null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const metrics = prepareWaveformCanvas(canvas, ctx, displaySize);
  const t = performance.now() / 1000;
  const bars = 40;
  const barW = 2;
  const gap = (metrics.cssWidth - bars * barW) / (bars - 1);
  const recording = getCanvasPalette().recording;
  for (let i = 0; i < bars; i++) {
    const x = i * (barW + gap);
    const freq = 1.5 + (i % 5) * 0.3;
    const phase = i * 0.4;
    const amp = 0.3 + 0.4 * Math.abs(Math.sin(i * 0.2));
    const v = 0.5 + amp * Math.sin(t * freq + phase);
    const barH = Math.max(3, v * metrics.cssHeight * 0.85);
    const y = (metrics.cssHeight - barH) / 2;
    ctx.fillStyle = withCanvasAlpha(recording, 0.5 + 0.5 * v);
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 1);
    ctx.fill();
  }
}

function drawPlaybackWaveformCanvas(
  canvas: HTMLCanvasElement,
  waveform: Float32Array | null,
  currentTime: number,
  duration: number,
  displaySize: WaveformDisplaySize | null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const metrics = prepareWaveformCanvas(canvas, ctx, displaySize);
  if (!waveform) {
    return;
  }
  const progress = duration > 0 ? currentTime / duration : 0;
  drawWaveform(ctx, waveform, metrics.cssWidth, metrics.cssHeight, progress);
}

interface AudioPlayerViewProps {
  elementId: string;
  audioBytes: Uint8Array | null;
  duration: number;
  mimeType: string;
  waveform: Float32Array | null;
  segments: readonly TranscriptSegment[];
  /** Gates the recording slot only — transcription is capability/claim-gated. */
  isCreator: boolean;
  /** The element's transcription claim; '' when never claimed. */
  transcribingPeerId: string;
  localPeerId: string;
  localMode: PeerMode;
  remotePeers: readonly LivePeer[];
  onRecorded: (
    data: Uint8Array,
    duration: number,
    mimeType: string,
    waveform: Float32Array | null,
  ) => void;
  onTranscribed: (segments: TranscriptSegment[]) => void;
  onTranscriptionClaimed: () => void;
  onTranscriptionClaimReleased: () => void;
}

interface AudioPlayerInteractionOptions {
  audioBytes: Uint8Array | null;
  hasTranscript: boolean;
  isCreator: boolean;
  slot: TranscriptionSlotState;
}

export interface AudioPlayerInteractionState {
  isWaitingForRemoteAudio: boolean;
  isCaptionsLoading: boolean;
  primaryButtonDisabled: boolean;
  captionsButtonDisabled: boolean;
}

export function getAudioPlayerInteractionState({
  audioBytes,
  hasTranscript,
  isCreator,
  slot,
}: AudioPlayerInteractionOptions): AudioPlayerInteractionState {
  const hasAudio = Boolean(audioBytes);
  const isWaitingForRemoteAudio = !hasAudio && !isCreator;
  const isCaptionsLoading =
    slot.kind === 'transcribing-here' || slot.kind === 'transcribing-remote';
  return {
    isWaitingForRemoteAudio,
    isCaptionsLoading,
    primaryButtonDisabled: isWaitingForRemoteAudio,
    // Enabled to toggle an existing transcript or to start a job here;
    // disabled while a job runs (here or remotely) and when unavailable.
    captionsButtonDisabled: !hasTranscript && slot.kind !== 'can-transcribe',
  };
}

export function AudioPlayerView({
  elementId,
  audioBytes,
  duration,
  mimeType,
  waveform,
  segments,
  isCreator,
  transcribingPeerId,
  localPeerId,
  localMode,
  remotePeers,
  onRecorded,
  onTranscribed,
  onTranscriptionClaimed,
  onTranscriptionClaimReleased,
}: AudioPlayerViewProps) {
  const strings = useMessages().canvas.audioPlayer;
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Cleared as soon as the reader scrolls the panel themselves, re-armed on the next seek or play.
  const [followPlayhead, setFollowPlayhead] = useState(true);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const transcriptionSessionRef = useRef<AudioTranscriptionSession | null>(
    null,
  );
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef(0);
  const recordTickRef = useRef(0);
  const noticeTimerRef = useRef(0);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const displaySizeRef = useRef<WaveformDisplaySize | null>(null);
  const disposedRef = useRef(false);
  // One auto-pickup attempt per audio blob per window — a failed run must
  // degrade to the manual Transcribe affordance, not retry in a loop.
  const autoPickupAttemptedRef = useRef(false);
  const isRecording = recordingState === 'recording';
  const isRequestingRecording = recordingState === 'requesting';
  const canTranscribe = getPlatform().transcription !== undefined;
  const hasTranscript = segments.length > 0;
  const activeIndex = activeSegmentIndex(segments, currentTime);
  const claimInput: TranscriptionCoordinationInput = {
    hasAudio: Boolean(audioBytes),
    hasTranscript,
    claimPeerId: transcribingPeerId,
    localPeerId,
    localMode,
    localCapable: canTranscribe,
    isTranscribingLocally: isTranscribing,
    remotePeers,
  };
  const slot = getTranscriptionSlotState(claimInput);
  const showCaptionsButton = Boolean(audioBytes);
  const interaction = getAudioPlayerInteractionState({
    audioBytes,
    hasTranscript,
    isCreator,
    slot,
  });
  const redrawAfterResize = useEffectEvent(() => {
    const canvas = waveformCanvasRef.current;
    // While recording, the rAF loop repaints with the new size next frame.
    if (!canvas || isRecording) {
      return;
    }
    drawPlaybackWaveformCanvas(
      canvas,
      waveform,
      currentTime,
      duration,
      displaySizeRef.current,
    );
  });

  // Tear down recording resources when the element is deleted mid-recording.
  useEffect(
    () => () => {
      disposedRef.current = true;
      clearInterval(recordTickRef.current);
      clearTimeout(noticeTimerRef.current);
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') {
        // Skip finalizeRecording — the element is gone; just stop the mic.
        recorder.onstop = null;
        recorder.stop();
        recorder.stream.getTracks().forEach((t) => {
          t.stop();
        });
      }
      // Cancel rather than finish: the element is gone, so abort any
      // in-flight whisper run instead of letting it grind to completion.
      void transcriptionSessionRef.current?.cancel();
      transcriptionSessionRef.current = null;
    },
    [],
  );

  // Drop the player bound to the previous blob when a new one arrives
  // (re-recording or a remote Yjs update), and on unmount.
  useEffect(() => {
    if (!audioBytes) {
      return;
    }
    return () => {
      audioElRef.current?.pause();
      audioElRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      autoPickupAttemptedRef.current = false;
      setIsPlaying(false);
      setCurrentTime(0);
      setRecordingState('idle');
      setShowTranscript(false);
      setFollowPlayhead(true);
    };
  }, [audioBytes]);

  const attemptAutoPickup = useEffectEvent(() => {
    // transcriptionSessionRef is the synchronous "a job is already running here" signal — it stays
    // accurate through onRecorded's flushSync re-render, where isTranscribingLocally hasn't committed.
    if (
      !shouldStartAutoPickup({
        eligible: shouldAutoTranscribe(claimInput),
        sessionInFlight: transcriptionSessionRef.current !== null,
        alreadyAttempted: autoPickupAttemptedRef.current,
      })
    ) {
      return;
    }
    autoPickupAttemptedRef.current = true;
    void handleTranscribe();
  });

  // This window started a job (e.g. before a reload) that never delivered a transcript. Remote
  // peers see our claim as active while we're present, so no one else will act — resume it.
  const autoPickupEligible = shouldAutoTranscribe(claimInput);
  useEffect(() => {
    if (autoPickupEligible) {
      attemptAutoPickup();
    }
  }, [autoPickupEligible]);

  // Animate recording visualization on the waveform canvas.
  useEffect(() => {
    if (!isRecording) {
      return;
    }
    let frameId: number;
    function animate() {
      const canvas = waveformCanvasRef.current;
      if (canvas) {
        drawRecordingWaveformFrame(canvas, displaySizeRef.current);
      }
      frameId = requestAnimationFrame(animate);
    }
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [isRecording]);

  // Redraw waveform canvas whenever the waveform data or playhead moves.
  useLayoutEffect(() => {
    if (!isRecording) {
      const canvas = waveformCanvasRef.current;
      if (canvas) {
        drawPlaybackWaveformCanvas(
          canvas,
          waveform,
          currentTime,
          duration,
          displaySizeRef.current,
        );
      }
    }
  }, [waveform, currentTime, duration, isRecording]);

  const getSegmentRowKey = useCallback(
    (index: number) => String(segments[index].startSeconds),
    [segments],
  );

  useLayoutEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) {
        displaySizeRef.current = {
          cssWidth: rect.width,
          cssHeight: rect.height,
        };
      }
      redrawAfterResize();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  /** Show a transient status line (e.g. "No speech detected") in the time slot. */
  function flashNotice(message: string) {
    clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 4000);
  }

  async function startRecording() {
    if (!isCreator) {
      return;
    }
    setRecordingState('requesting');
    setCurrentTime(0);
    setNotice(null);

    let stream: MediaStream | null = null;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      ) {
        setRecordingState('error');
        return;
      }

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recordingStream = stream;
      if (disposedRef.current) {
        recordingStream.getTracks().forEach((t) => {
          t.stop();
        });
        return;
      }

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      const transcriptionSession =
        (await getPlatform().transcription?.startSession({
          elementId,
          stream: recordingStream,
        })) ?? null;
      if (disposedRef.current) {
        recordingStream.getTracks().forEach((t) => {
          t.stop();
        });
        void transcriptionSession?.cancel();
        return;
      }
      // Claim now, not when the transcript lands: audioData syncs with an empty transcript well before
      // whisper finishes, and every capable peer would otherwise offer manual Transcribe in that window.
      if (
        shouldClaimOnRecordingStart({
          transcriptionSessionStarted: transcriptionSession !== null,
          localMode,
        })
      ) {
        onTranscriptionClaimed();
      }
      recordChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      transcriptionSessionRef.current = transcriptionSession;
      recordStartRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        clearInterval(recordTickRef.current);
        recordingStream.getTracks().forEach((t) => {
          t.stop();
        });
        // The ref stays set while whisper finishes so deleting the element
        // mid-transcription can still cancel the backend session.
        void finalizeRecording(
          recorder.mimeType,
          transcriptionSessionRef.current,
        );
      };

      recorder.start(100);
      // Capture opened above; anchor the transcript's clock to the file that starts here.
      transcriptionSession?.markRecordingStart();
      setRecordingState('recording');

      clearInterval(recordTickRef.current);
      recordTickRef.current = window.setInterval(() => {
        setCurrentTime((Date.now() - recordStartRef.current) / 1000);
      }, 200);
    } catch {
      clearInterval(recordTickRef.current);
      mediaRecorderRef.current = null;
      void transcriptionSessionRef.current?.cancel();
      transcriptionSessionRef.current = null;
      // The claim may already be written for a session that will never
      // deliver; release it (a no-op unless the claim is ours).
      onTranscriptionClaimReleased();
      stream?.getTracks().forEach((t) => {
        t.stop();
      });
      setRecordingState('error');
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    clearInterval(recordTickRef.current);
    setRecordingState('idle');
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  async function finalizeRecording(
    recordedMimeType: string,
    transcription: AudioTranscriptionSession | null,
  ) {
    const transcriptPromise =
      transcription?.finish() ?? Promise.resolve<TranscriptSegment[]>([]);
    const chunks = recordChunksRef.current;
    recordChunksRef.current = [];

    if (chunks.length === 0) {
      if (transcriptionSessionRef.current === transcription) {
        transcriptionSessionRef.current = null;
      }
      if (transcription) {
        onTranscriptionClaimReleased();
      }
      return;
    }

    const blob = new Blob(chunks, { type: recordedMimeType });
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    let dur = 0;
    let recordedWaveform: Float32Array | null = null;
    try {
      const decoded = await decodeAudio(bytes);
      dur = decoded.duration;
      recordedWaveform = decoded.waveform;
    } catch {
      dur = (Date.now() - recordStartRef.current) / 1000;
      // An instant start/stop produces a header-only blob no decoder accepts. Discard it rather than
      // leave an unplayable card. Longer recordings that fail to decode are kept with wall-clock duration.
      if (dur < 1) {
        if (transcriptionSessionRef.current === transcription) {
          transcriptionSessionRef.current = null;
        }
        if (transcription) {
          onTranscriptionClaimReleased();
        }
        return;
      }
    }

    if (disposedRef.current) {
      return;
    }
    // Publish right away — waveform and playback must not wait on whisper. transcriptionSessionRef is
    // still set here, so the auto-pickup effect this render fires sees the live job and won't duplicate.
    onRecorded(bytes, dur, recordedMimeType, recordedWaveform);

    if (!transcription) {
      return;
    }
    setIsTranscribing(true);
    const transcribed = await transcriptPromise.catch(
      (): TranscriptSegment[] => [],
    );
    if (transcriptionSessionRef.current === transcription) {
      transcriptionSessionRef.current = null;
    }
    if (disposedRef.current) {
      return;
    }
    setIsTranscribing(false);
    trackEvent('transcription_completed', {
      duration_seconds: Math.round(dur),
      transcript_length: segmentsToText(transcribed).length,
      had_speech: transcribed.length > 0,
    });
    if (transcribed.length > 0) {
      onTranscribed(transcribed);
    } else {
      // The claim must not outlive the job: present-but-idle would read as
      // "still transcribing" to remote peers forever.
      onTranscriptionClaimReleased();
      flashNotice(strings.noSpeechDetected);
    }
  }

  /** The player for the current blob, created on first use. `null` while no audio has arrived. */
  function ensureAudio(): HTMLAudioElement | null {
    if (!audioBytes) {
      return null;
    }

    if (!audioElRef.current) {
      const audio = new Audio();
      audio.addEventListener('timeupdate', () => {
        setCurrentTime(audio.currentTime);
      });
      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setCurrentTime(0);
        audio.currentTime = 0;
      });
      audioElRef.current = audio;
    }

    if (!objectUrlRef.current) {
      const buf = audioBytes.buffer.slice(
        audioBytes.byteOffset,
        audioBytes.byteOffset + audioBytes.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([buf], mimeType ? { type: mimeType } : undefined);
      objectUrlRef.current = URL.createObjectURL(blob);
      audioElRef.current.src = objectUrlRef.current;
    }

    return audioElRef.current;
  }

  function startPlayback() {
    const audio = ensureAudio();
    if (!audio) {
      return;
    }

    setFollowPlayhead(true);
    setIsPlaying(true);
    audio.play().catch(() => {
      setIsPlaying(false);
    });
  }

  function seekTo(seconds: number) {
    const audio = ensureAudio();
    if (!audio) {
      return;
    }

    audio.currentTime = seconds;
    // `timeupdate` only fires once the seek lands, so move the playhead now.
    setCurrentTime(seconds);
    if (isPlaying) {
      setFollowPlayhead(true);
    } else {
      startPlayback();
    }
  }

  function pausePlayback() {
    audioElRef.current?.pause();
    setIsPlaying(false);
  }

  // Recordings are transcribed live; this is the on-demand path for imported audio, the retry path,
  // and the orphaned-claim pickup. Any capable owner-device peer may run it — creator-ness gates
  // recording only.
  async function handleTranscribe() {
    const transcription = getPlatform().transcription;
    if (!audioBytes || !transcription || !canTranscribeHere(claimInput)) {
      return;
    }
    setIsTranscribing(true);
    setNotice(null);
    onTranscriptionClaimed();
    try {
      const { buffer } = await decodeAudio(audioBytes);
      const session = await transcription.startBufferSession(elementId, buffer);
      if (!session) {
        // Backend unavailable (e.g. bundled model missing).
        if (!disposedRef.current) {
          onTranscriptionClaimReleased();
          flashNotice(strings.transcriptionFailed);
        }
        return;
      }
      if (disposedRef.current) {
        void session.cancel();
        return;
      }
      transcriptionSessionRef.current = session;
      const transcribed = await session.finish();
      if (transcriptionSessionRef.current === session) {
        transcriptionSessionRef.current = null;
      }
      if (disposedRef.current) {
        return;
      }
      if (transcribed.length > 0) {
        onTranscribed(transcribed);
        setShowTranscript(true);
      } else {
        onTranscriptionClaimReleased();
        // Whisper ran and heard nothing.
        flashNotice(strings.noSpeechDetected);
      }
    } catch (error) {
      logger.error('On-demand audio transcription failed', error, {
        elementId,
      });
      // The button stays visible as the retry affordance.
      if (!disposedRef.current) {
        onTranscriptionClaimReleased();
        flashNotice(strings.transcriptionFailed);
      }
    } finally {
      if (!disposedRef.current) {
        setIsTranscribing(false);
      }
    }
  }

  function handleCaptionsClick() {
    if (hasTranscript) {
      setShowTranscript((open) => !open);
      // Reopening starts following again, wherever the reader left the scroll last time.
      setFollowPlayhead(true);
    } else if (slot.kind === 'can-transcribe') {
      void handleTranscribe();
    }
  }

  function handleButtonClick() {
    if (isRequestingRecording || interaction.isWaitingForRemoteAudio) {
      return;
    }
    if (isRecording) {
      stopRecording();
    } else if (audioBytes) {
      if (isPlaying) {
        pausePlayback();
      } else {
        startPlayback();
      }
    } else {
      void startRecording();
    }
  }

  const ButtonIcon = isRecording
    ? SquareIcon
    : audioBytes
      ? isPlaying
        ? PauseIcon
        : PlayIcon
      : MicIcon;

  const timeLabel = isRequestingRecording
    ? strings.requestingMic
    : recordingState === 'error'
      ? strings.micUnavailable
      : isRecording
        ? formatTime(currentTime)
        : (notice ??
          (audioBytes
            ? `${formatTime(currentTime)} / ${formatTime(duration)}`
            : interaction.isWaitingForRemoteAudio
              ? strings.waitingForRecording
              : strings.tapToRecord));

  const captionsLabel = hasTranscript
    ? showTranscript
      ? strings.hideTranscript
      : strings.showTranscript
    : slot.kind === 'transcribing-remote'
      ? strings.transcribingOn(formatPeerId(slot.peerId))
      : slot.kind === 'transcribing-here'
        ? strings.transcribing
        : slot.kind === 'unavailable'
          ? strings.transcriptionUnavailable
          : strings.transcribe;

  const buttonLabel = isRequestingRecording
    ? strings.requestingMicAccess
    : isRecording
      ? strings.stopRecording
      : audioBytes
        ? isPlaying
          ? strings.pauseAudio
          : strings.playAudio
        : interaction.isWaitingForRemoteAudio
          ? strings.waitingForRecording
          : recordingState === 'error'
            ? strings.tryRecordingAgain
            : strings.startRecording;

  return (
    <div className="canvas-audio-inner" data-recording-state={recordingState}>
      <button
        type="button"
        className="canvas-audio-btn"
        onClick={handleButtonClick}
        disabled={isRequestingRecording || interaction.primaryButtonDisabled}
        aria-label={buttonLabel}
        title={buttonLabel}
      >
        <ButtonIcon size={16} />
      </button>
      <div className="canvas-audio-body">
        <canvas
          ref={waveformCanvasRef}
          className="canvas-audio-waveform"
          width={188}
          height={28}
        />
        <span className="canvas-audio-time">{timeLabel}</span>
      </div>
      {showCaptionsButton && (
        <button
          type="button"
          className="canvas-audio-transcribe"
          data-active={showTranscript && hasTranscript}
          onClick={handleCaptionsClick}
          disabled={interaction.captionsButtonDisabled}
          aria-label={captionsLabel}
          title={captionsLabel}
        >
          {interaction.isCaptionsLoading ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <CaptionsIcon size={14} />
          )}
        </button>
      )}
      {showTranscript && hasTranscript && (
        <div
          ref={transcriptRef}
          className="canvas-audio-transcript"
          onWheel={(e) => {
            // Scroll the transcript, not the canvas zoom underneath.
            e.stopPropagation();
            setFollowPlayhead(false);
          }}
          onTouchMove={() => {
            setFollowPlayhead(false);
          }}
        >
          <VirtualList
            scrollRef={transcriptRef}
            count={segments.length}
            estimateHeight={estimateSegmentRowHeight}
            getRowKey={getSegmentRowKey}
            gap={0}
            pinnedIndex={followPlayhead ? activeIndex : null}
            renderRow={(index) => {
              const segment = segments[index];
              return (
                <div
                  className="canvas-audio-transcript-row"
                  data-active={index === activeIndex}
                >
                  <button
                    type="button"
                    className="canvas-audio-transcript-time"
                    onClick={() => {
                      seekTo(segment.startSeconds);
                    }}
                    aria-label={strings.playFrom(
                      formatTime(segment.startSeconds),
                    )}
                  >
                    {formatTime(segment.startSeconds)}
                  </button>
                  <span>{segment.text}</span>
                </div>
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
