import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Mic as MicIcon,
  Pause as PauseIcon,
  Play as PlayIcon,
  Square as SquareIcon,
} from 'lucide-react';
import {
  type AudioTranscriptionSession,
  startAudioTranscription,
} from '@/lib/audio-transcription/service';
import { useMessages } from '@/lib/i18n';

const WAVEFORM_BARS = 80;

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
  onRecorded: (
    data: Uint8Array,
    duration: number,
    mimeType: string,
    transcript: string,
  ) => void;
}

export function AudioPlayerView({
  elementId,
  audioBytes,
  duration,
  mimeType,
  waveform,
  onRecorded,
}: AudioPlayerViewProps) {
  const strings = useMessages().canvas.audioPlayer;
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

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
    const canvas = waveformCanvasRef.current;
    if (!isRecording || !canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    let frameId: number;
    function animate() {
      const t = performance.now() / 1000;
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      const BARS = 40;
      const barW = 2;
      const gap = (canvas!.width - BARS * barW) / (BARS - 1);
      for (let i = 0; i < BARS; i++) {
        const x = i * (barW + gap);
        const freq = 1.5 + (i % 5) * 0.3;
        const phase = i * 0.4;
        const amp = 0.3 + 0.4 * Math.abs(Math.sin(i * 0.2));
        const v = 0.5 + amp * Math.sin(t * freq + phase);
        const barH = Math.max(3, v * canvas!.height * 0.85);
        const y = (canvas!.height - barH) / 2;
        ctx!.fillStyle = `rgba(224, 62, 62, ${0.5 + 0.5 * v})`;
        ctx!.beginPath();
        ctx!.roundRect(x, y, barW, barH, 1);
        ctx!.fill();
      }
      frameId = requestAnimationFrame(animate);
    }
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [isRecording]);

  // Redraw waveform canvas whenever the waveform data or playhead moves.
  useLayoutEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !waveform) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const progress = duration > 0 ? currentTime / duration : 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawWaveform(ctx, waveform, canvas.width, canvas.height, progress);
  }, [waveform, currentTime, duration]);

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
    </div>
  );
}
