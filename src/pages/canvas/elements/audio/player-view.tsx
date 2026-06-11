import {
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
import {
  type AudioTranscriptionSession,
  startAudioTranscription,
  transcribeAudioBuffer,
} from '@/lib/audio-transcription/service';
import { useMessages } from '@/lib/i18n';

const WAVEFORM_BARS = 80;
const MAX_WAVEFORM_BACKING_DIMENSION = 4096;

type RecordingState = 'idle' | 'requesting' | 'recording' | 'error';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface DecodedAudio {
  buffer: AudioBuffer;
  waveform: Float32Array;
  duration: number;
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
  const safeDpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const pixelRatio = Math.min(
    safeDpr,
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

function getWaveformCanvasDisplaySize(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = rect.width || canvas.clientWidth || canvas.width;
  const cssHeight = rect.height || canvas.clientHeight || canvas.height;
  return { cssWidth, cssHeight };
}

function prepareWaveformCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): WaveformCanvasMetrics {
  const { cssWidth, cssHeight } = getWaveformCanvasDisplaySize(canvas);
  const metrics = getWaveformCanvasMetrics(
    cssWidth,
    cssHeight,
    window.devicePixelRatio || 1,
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

function drawRecordingWaveformFrame(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const metrics = prepareWaveformCanvas(canvas, ctx);
  const t = performance.now() / 1000;
  const bars = 40;
  const barW = 2;
  const gap = (metrics.cssWidth - bars * barW) / (bars - 1);
  for (let i = 0; i < bars; i++) {
    const x = i * (barW + gap);
    const freq = 1.5 + (i % 5) * 0.3;
    const phase = i * 0.4;
    const amp = 0.3 + 0.4 * Math.abs(Math.sin(i * 0.2));
    const v = 0.5 + amp * Math.sin(t * freq + phase);
    const barH = Math.max(3, v * metrics.cssHeight * 0.85);
    const y = (metrics.cssHeight - barH) / 2;
    ctx.fillStyle = `rgba(224, 62, 62, ${0.5 + 0.5 * v})`;
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
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const metrics = prepareWaveformCanvas(canvas, ctx);
  if (!waveform) {
    return;
  }
  const progress = duration > 0 ? currentTime / duration : 0;
  drawWaveform(ctx, waveform, metrics.cssWidth, metrics.cssHeight, progress);
}

/** Single decode shared by the element, the player, and the import handler. */
export async function decodeAudio(bytes: Uint8Array): Promise<DecodedAudio> {
  const ctx = new AudioContext();
  try {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const decoded = await ctx.decodeAudioData(buffer as ArrayBuffer);
    const channel = decoded.getChannelData(0);
    const samplesPerBar = Math.max(
      1,
      Math.floor(channel.length / WAVEFORM_BARS),
    );
    const waveform = new Float32Array(WAVEFORM_BARS);
    for (let i = 0; i < WAVEFORM_BARS; i++) {
      let peak = 0;
      const start = i * samplesPerBar;
      const end = Math.min(start + samplesPerBar, channel.length);
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channel[j]);
        if (abs > peak) {
          peak = abs;
        }
      }
      waveform[i] = peak;
    }
    return { buffer: decoded, waveform, duration: decoded.duration };
  } finally {
    ctx.close();
  }
}

/** Does not clear the canvas — drawThumbnail paints onto an existing card. */
export function drawWaveform(
  ctx2d: CanvasRenderingContext2D,
  waveform: Float32Array,
  width: number,
  height: number,
  progress: number,
): void {
  const bars = waveform.length;
  const barW = 2;
  const gap = (width - bars * barW) / (bars - 1);
  const cx = width * progress;
  const minBarH = 3;

  for (let i = 0; i < bars; i++) {
    const x = i * (barW + gap);
    const barH = Math.max(minBarH, waveform[i] * height * 0.85);
    const y = (height - barH) / 2;
    ctx2d.fillStyle = x + barW < cx ? '#1c2738' : '#d0d5db';
    ctx2d.beginPath();
    ctx2d.roundRect(x, y, barW, barH, 1);
    ctx2d.fill();
  }
}

interface AudioPlayerViewProps {
  elementId: string;
  audioBytes: Uint8Array | null;
  duration: number;
  mimeType: string;
  waveform: Float32Array | null;
  transcript: string;
  onRecorded: (
    data: Uint8Array,
    duration: number,
    mimeType: string,
    transcript: string,
  ) => void;
  onTranscribed: (transcript: string) => void;
}

export function AudioPlayerView({
  elementId,
  audioBytes,
  duration,
  mimeType,
  waveform,
  transcript,
  onRecorded,
  onTranscribed,
}: AudioPlayerViewProps) {
  const strings = useMessages().canvas.audioPlayer;
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const transcriptionSessionRef = useRef<AudioTranscriptionSession | null>(
    null,
  );
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef(0);
  const recordTickRef = useRef(0);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const disposedRef = useRef(false);
  const isRecording = recordingState === 'recording';
  const isRequestingRecording = recordingState === 'requesting';
  const redrawAfterResize = useEffectEvent(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) {
      return;
    }
    if (isRecording) {
      drawRecordingWaveformFrame(canvas);
    } else {
      drawPlaybackWaveformCanvas(canvas, waveform, currentTime, duration);
    }
  });

  // Tear down recording resources when the element is deleted mid-recording.
  useEffect(
    () => () => {
      disposedRef.current = true;
      clearInterval(recordTickRef.current);
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
      void transcriptionSessionRef.current?.finish();
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
      setIsPlaying(false);
      setCurrentTime(0);
      setRecordingState('idle');
    };
  }, [audioBytes]);

  // Animate recording visualization on the waveform canvas.
  useEffect(() => {
    if (!isRecording) {
      return;
    }
    let frameId: number;
    function animate() {
      const canvas = waveformCanvasRef.current;
      if (canvas) {
        drawRecordingWaveformFrame(canvas);
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
        drawPlaybackWaveformCanvas(canvas, waveform, currentTime, duration);
      }
    }
  }, [waveform, currentTime, duration, isRecording]);

  useLayoutEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      redrawAfterResize();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  async function startRecording() {
    setRecordingState('requesting');
    setCurrentTime(0);

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
      const transcriptionSession = await startAudioTranscription({
        elementId,
        stream: recordingStream,
      });
      if (disposedRef.current) {
        recordingStream.getTracks().forEach((t) => {
          t.stop();
        });
        void transcriptionSession?.finish();
        return;
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
        const transcription = transcriptionSessionRef.current;
        transcriptionSessionRef.current = null;
        void finalizeRecording(recorder.mimeType, transcription);
      };

      recorder.start(100);
      setRecordingState('recording');

      clearInterval(recordTickRef.current);
      recordTickRef.current = window.setInterval(() => {
        setCurrentTime((Date.now() - recordStartRef.current) / 1000);
      }, 200);
    } catch {
      clearInterval(recordTickRef.current);
      mediaRecorderRef.current = null;
      void transcriptionSessionRef.current?.finish();
      transcriptionSessionRef.current = null;
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
    const transcriptPromise = transcription?.finish() ?? Promise.resolve('');
    const chunks = recordChunksRef.current;
    recordChunksRef.current = [];

    if (chunks.length === 0) {
      return;
    }

    const blob = new Blob(chunks, { type: recordedMimeType });
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    let dur = 0;
    try {
      dur = (await decodeAudio(bytes)).duration;
    } catch {
      dur = (Date.now() - recordStartRef.current) / 1000;
    }

    const transcript = await transcriptPromise.catch(() => '');
    if (disposedRef.current) {
      return;
    }
    onRecorded(bytes, dur, recordedMimeType, transcript);
  }

  function startPlayback() {
    if (!audioBytes) {
      return;
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

    setIsPlaying(true);
    audioElRef.current.play().catch(() => {
      setIsPlaying(false);
    });
  }

  function pausePlayback() {
    audioElRef.current?.pause();
    setIsPlaying(false);
  }

  // Recordings are transcribed live; this is the on-demand path for imported
  // audio (and the retry path for recordings whose transcription failed).
  async function handleTranscribe() {
    if (!audioBytes || isTranscribing) {
      return;
    }
    setIsTranscribing(true);
    try {
      const { buffer } = await decodeAudio(audioBytes);
      const text = await transcribeAudioBuffer(elementId, buffer);
      if (!disposedRef.current && text) {
        onTranscribed(text);
      }
    } catch {
      // The button stays visible as the retry affordance.
    } finally {
      if (!disposedRef.current) {
        setIsTranscribing(false);
      }
    }
  }

  function handleButtonClick() {
    if (isRequestingRecording) {
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
        : audioBytes
          ? `${formatTime(currentTime)} / ${formatTime(duration)}`
          : strings.tapToRecord;

  const buttonLabel = isRequestingRecording
    ? strings.requestingMicAccess
    : isRecording
      ? strings.stopRecording
      : audioBytes
        ? isPlaying
          ? strings.pauseAudio
          : strings.playAudio
        : recordingState === 'error'
          ? strings.tryRecordingAgain
          : strings.startRecording;

  return (
    <div className="canvas-audio-inner" data-recording-state={recordingState}>
      <button
        type="button"
        className="canvas-audio-btn"
        onClick={handleButtonClick}
        disabled={isRequestingRecording}
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
      {audioBytes && !transcript && (
        <button
          type="button"
          className="canvas-audio-transcribe"
          onClick={handleTranscribe}
          disabled={isTranscribing}
          aria-label={
            isTranscribing ? strings.transcribing : strings.transcribe
          }
          title={isTranscribing ? strings.transcribing : strings.transcribe}
        >
          {isTranscribing ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <CaptionsIcon size={14} />
          )}
        </button>
      )}
    </div>
  );
}
