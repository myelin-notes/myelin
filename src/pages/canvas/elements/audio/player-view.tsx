import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Mic as MicIcon,
  Pause as PauseIcon,
  Play as PlayIcon,
  Square as SquareIcon,
} from 'lucide-react';

const WAVEFORM_BARS = 80;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function decodeWaveform(bytes: Uint8Array): Promise<Float32Array> {
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
    const result = new Float32Array(WAVEFORM_BARS);
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
      result[i] = peak;
    }
    return result;
  } finally {
    ctx.close();
  }
}

function drawWaveform(
  ctx2d: CanvasRenderingContext2D,
  waveform: Float32Array,
  width: number,
  height: number,
  progress: number,
): void {
  ctx2d.clearRect(0, 0, width, height);
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

export interface AudioPlayerViewHandle {
  setAudioData(
    data: Uint8Array | null,
    duration: number,
    mimeType: string,
  ): void;
}

interface AudioPlayerViewProps {
  onRecorded: (data: Uint8Array, duration: number, mimeType: string) => void;
}

export const AudioPlayerView = forwardRef<
  AudioPlayerViewHandle,
  AudioPlayerViewProps
>(function AudioPlayerView({ onRecorded }, ref) {
  const [audioBytes, setAudioBytes] = useState<Uint8Array | null>(null);
  const [duration, setDuration] = useState(0);
  const [mimeType, setMimeType] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [waveform, setWaveform] = useState<Float32Array | null>(null);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef(0);
  const recordTickRef = useRef(0);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);

  // Stable ref for the onRecorded callback so recording closures always see
  // the current value without widening effect dependency lists.
  const onRecordedRef = useRef(onRecorded);
  useLayoutEffect(() => {
    onRecordedRef.current = onRecorded;
  });

  useImperativeHandle(ref, () => ({
    setAudioData(data, dur, mime) {
      // Reset local playback state when Yjs delivers a new audio blob.
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setAudioBytes(data ? new Uint8Array(data) : null);
      setDuration(dur);
      setMimeType(mime);
      setIsPlaying(false);
      setCurrentTime(0);
      setWaveform(null);
    },
  }));

  // Decode waveform whenever audioBytes changes.
  useEffect(() => {
    if (!audioBytes) {
      return;
    }
    let cancelled = false;
    decodeWaveform(audioBytes)
      .then((wf) => {
        if (!cancelled) {
          setWaveform(wf);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
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
    drawWaveform(ctx, waveform, canvas.width, canvas.height, progress);
  }, [waveform, currentTime, duration]);

  // --- Recording ---

  async function startRecording() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
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
    recordChunksRef.current = [];
    mediaRecorderRef.current = recorder;
    recordStartRef.current = Date.now();

    setIsRecording(true);
    setCurrentTime(0);

    recordTickRef.current = window.setInterval(() => {
      setCurrentTime((Date.now() - recordStartRef.current) / 1000);
    }, 200);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      clearInterval(recordTickRef.current);
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      void finalizeRecording(recorder.mimeType);
    };

    recorder.start(100);
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    clearInterval(recordTickRef.current);
    setIsRecording(false);
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  async function finalizeRecording(recordedMimeType: string) {
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
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      dur = decoded.duration;
      ctx.close();
    } catch {
      dur = (Date.now() - recordStartRef.current) / 1000;
    }

    onRecordedRef.current(bytes, dur, recordedMimeType);
  }

  // --- Playback ---

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

  const timeLabel = isRecording
    ? formatTime(currentTime)
    : audioBytes
      ? `${formatTime(currentTime)} / ${formatTime(duration)}`
      : 'Tap to record';

  return (
    <div
      className="canvas-audio-inner"
      data-recording={isRecording ? 'true' : 'false'}
    >
      <button
        type="button"
        className="canvas-audio-btn"
        onClick={handleButtonClick}
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
});
