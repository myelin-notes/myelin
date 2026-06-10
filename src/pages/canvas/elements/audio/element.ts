import type * as Y from 'yjs';
import type { CanvasViewport } from '../../canvas-viewport';
import { DrawableElement, ResizeHandles } from '../drawable-element';
import { ElementType } from '../element-type';

const NATURAL_WIDTH = 280;
const NATURAL_HEIGHT = 72;
const WAVEFORM_BARS = 80;

// SVG icons for the player button (20×20 viewport, centered in the 36px button)
const PLAY_SVG =
  '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><polygon points="5,3 17,10 5,17"/></svg>';
const PAUSE_SVG =
  '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><rect x="4" y="3" width="4" height="14" rx="1"/><rect x="12" y="3" width="4" height="14" rx="1"/></svg>';
const STOP_SVG =
  '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>';
const RECORD_SVG =
  '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><circle cx="10" cy="10" r="6"/></svg>';

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
    ctx2d.fillStyle = x + barW < cx ? '#2f3e46' : '#d0d5db';
    ctx2d.beginPath();
    ctx2d.roundRect(x, y, barW, barH, 1);
    ctx2d.fill();
  }
}

export class AudioElement extends DrawableElement {
  private _audioData: Uint8Array | null = null;
  private _fileName: string = '';
  private _duration: number = 0;
  private _mimeType: string = '';

  // Local state — not synced
  private _waveform: Float32Array | null = null;
  private _waveformForData: Uint8Array | null = null;
  private _isPlaying: boolean = false;
  private _currentTime: number = 0;
  private _isRecording: boolean = false;
  private _mediaRecorder: MediaRecorder | null = null;
  private _recordChunks: Blob[] = [];
  private _recordMimeType: string = '';
  private _recordStartTime: number = 0;
  private _recordTick: number = 0;
  private _audioEl: HTMLAudioElement | null = null;
  private _objectUrl: string | null = null;

  // DOM refs
  private _root: HTMLDivElement | null = null;
  private _btnEl: HTMLButtonElement | null = null;
  private _recDot: HTMLDivElement | null = null;
  private _waveformCanvas: HTMLCanvasElement | null = null;
  private _timeEl: HTMLSpanElement | null = null;
  private _lastRenderedProgress: number = -1;

  constructor(uuid: string) {
    super(uuid, ElementType.AUDIO);
  }

  public override getYMapProps(): Record<string, unknown> {
    const props: Record<string, unknown> = {
      fileName: this._fileName,
      duration: this._duration,
      mimeType: this._mimeType,
    };
    if (this._audioData) {
      props.audioData = new Uint8Array(this._audioData);
    }
    return props;
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      fileName: (v) => {
        this._fileName = typeof v === 'string' ? v : '';
      },
      duration: (v) => {
        this._duration = typeof v === 'number' ? v : 0;
      },
      mimeType: (v) => {
        this._mimeType = typeof v === 'string' ? v : '';
      },
      audioData: (v) => {
        this._audioData = v instanceof Uint8Array ? new Uint8Array(v) : null;
        this.resetPlayback();
        this.scheduleWaveformDecode();
        this.updateDomState();
      },
    });
  }

  public get audioData(): Uint8Array | null {
    return this._audioData;
  }
  public get duration(): number {
    return this._duration;
  }

  public setAudioData(
    data: Uint8Array,
    fileName: string,
    duration: number,
    mimeType: string,
  ): void {
    this._audioData = new Uint8Array(data);
    this._fileName = fileName;
    this._duration = duration;
    this._mimeType = mimeType;
    this.syncToYMap({
      audioData: this._audioData,
      fileName,
      duration,
      mimeType,
    });
    this.resetPlayback();
    this.scheduleWaveformDecode();
    this.updateDomState();
  }

  public override get resizeHandles(): ResizeHandles {
    return ResizeHandles.Corners;
  }

  public override get maintainAspectRatio(): boolean {
    return true;
  }

  public get localBoundingBox(): DOMRect {
    return new DOMRect(0, 0, NATURAL_WIDTH, NATURAL_HEIGHT);
  }

  protected isOverLocal(x: number, y: number): boolean {
    return x >= 0 && x <= NATURAL_WIDTH && y >= 0 && y <= NATURAL_HEIGHT;
  }

  protected updateBoundingBox(): void {}

  // DOM-backed; 2D canvas draw is a no-op.
  protected draw2D(): void {}

  public override drawThumbnail(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(0, 0, NATURAL_WIDTH, NATURAL_HEIGHT, 10);
    ctx.fill();

    ctx.strokeStyle = 'rgba(195, 199, 202, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, NATURAL_WIDTH, NATURAL_HEIGHT, 10);
    ctx.stroke();

    const wf = this._waveform;
    if (wf) {
      ctx.save();
      ctx.translate(52, 0);
      drawWaveform(ctx, wf, NATURAL_WIDTH - 64, NATURAL_HEIGHT, 0);
      ctx.restore();
    }

    // Simple circle button placeholder
    ctx.fillStyle = '#2f3e46';
    ctx.beginPath();
    ctx.arc(28, NATURAL_HEIGHT / 2, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  public override syncDOM(viewport: CanvasViewport, host: HTMLElement): void {
    const root = this._root ?? this.createDom(host);

    const zoom = viewport.zoom;
    const screen = viewport.worldToScreen({
      x: this.offset.x,
      y: this.offset.y,
    });
    root.style.left = `${screen.x}px`;
    root.style.top = `${screen.y}px`;
    root.style.transform = `scale(${this._scale.x * zoom}, ${this._scale.y * zoom})`;

    // Sync time display while playing
    if (this._isPlaying && this._audioEl) {
      const t = this._audioEl.currentTime;
      if (t !== this._currentTime) {
        this._currentTime = t;
        if (this._timeEl) {
          this._timeEl.textContent = `${formatTime(t)} / ${formatTime(this._duration)}`;
        }
        this.redrawWaveformProgress();
      }
    }
  }

  public override disposeDOM(): void {
    this.stopRecording(false);
    this.resetPlayback();
    this._root?.remove();
    this._root = null;
    this._btnEl = null;
    this._recDot = null;
    this._waveformCanvas = null;
    this._timeEl = null;
    this._lastRenderedProgress = -1;
  }

  // --- DOM ---

  private createDom(host: HTMLElement): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'canvas-audio-block';
    root.dataset.elementUuid = this.uuid;

    const inner = document.createElement('div');
    inner.className = 'canvas-audio-inner';

    const btn = document.createElement('button');
    btn.className = 'canvas-audio-btn';
    btn.style.pointerEvents = 'auto';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleButtonClick();
    });
    this._btnEl = btn;

    const recDot = document.createElement('div');
    recDot.className = 'canvas-audio-rec-dot';
    recDot.style.display = 'none';
    this._recDot = recDot;

    const body = document.createElement('div');
    body.className = 'canvas-audio-body';

    const wfCanvas = document.createElement('canvas');
    wfCanvas.className = 'canvas-audio-waveform';
    wfCanvas.width = 188;
    wfCanvas.height = 32;
    this._waveformCanvas = wfCanvas;
    this._lastRenderedProgress = -1;

    const timeEl = document.createElement('span');
    timeEl.className = 'canvas-audio-time';
    this._timeEl = timeEl;

    body.appendChild(wfCanvas);
    body.appendChild(timeEl);

    inner.appendChild(btn);
    inner.appendChild(recDot);
    inner.appendChild(body);
    root.appendChild(inner);
    host.appendChild(root);
    this._root = root;

    this.updateDomState();
    return root;
  }

  private updateDomState(): void {
    const btn = this._btnEl;
    const timeEl = this._timeEl;
    const recDot = this._recDot;
    if (!btn || !timeEl || !recDot) {
      return;
    }

    if (this._isRecording) {
      btn.innerHTML = STOP_SVG;
      btn.title = 'Stop recording';
      recDot.style.display = 'block';
      timeEl.textContent = formatTime(this._currentTime);
      this.clearWaveformCanvas();
    } else if (this._audioData) {
      btn.innerHTML = this._isPlaying ? PAUSE_SVG : PLAY_SVG;
      btn.title = this._isPlaying ? 'Pause' : 'Play';
      recDot.style.display = 'none';
      timeEl.textContent = `${formatTime(this._currentTime)} / ${formatTime(this._duration)}`;
      this.redrawWaveformProgress();
    } else {
      btn.innerHTML = RECORD_SVG;
      btn.title = 'Start recording';
      recDot.style.display = 'none';
      timeEl.textContent = 'Tap to record';
      this.clearWaveformCanvas();
    }
  }

  private clearWaveformCanvas(): void {
    const canvas = this._waveformCanvas;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this._lastRenderedProgress = -1;
  }

  private redrawWaveformProgress(): void {
    const canvas = this._waveformCanvas;
    const wf = this._waveform;
    if (!canvas || !wf) {
      return;
    }

    const progress =
      this._duration > 0 ? this._currentTime / this._duration : 0;
    if (Math.abs(progress - this._lastRenderedProgress) < 0.002) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    drawWaveform(ctx, wf, canvas.width, canvas.height, progress);
    this._lastRenderedProgress = progress;
  }

  // --- Button logic ---

  private handleButtonClick(): void {
    if (this._isRecording) {
      this.stopRecording(true);
    } else if (this._audioData) {
      this.togglePlayback();
    } else {
      void this.startRecording();
    }
  }

  // --- Recording ---

  private async startRecording(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    this._recordChunks = [];
    this._recordMimeType = recorder.mimeType;
    this._mediaRecorder = recorder;
    this._isRecording = true;
    this._currentTime = 0;
    this._recordStartTime = Date.now();

    this._recordTick = window.setInterval(() => {
      if (!this._isRecording) {
        return;
      }
      this._currentTime = (Date.now() - this._recordStartTime) / 1000;
      if (this._timeEl) {
        this._timeEl.textContent = formatTime(this._currentTime);
      }
    }, 200);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this._recordChunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      clearInterval(this._recordTick);
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      void this.finalizeRecording();
    };

    recorder.start(100);
    this.updateDomState();
  }

  private stopRecording(save: boolean): void {
    const recorder = this._mediaRecorder;
    this._isRecording = false;
    this._mediaRecorder = null;
    clearInterval(this._recordTick);

    if (recorder && recorder.state !== 'inactive') {
      if (!save) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stream?.getTracks().forEach((t) => {
          t.stop();
        });
      }
      recorder.stop();
    }
  }

  private async finalizeRecording(): Promise<void> {
    const chunks = this._recordChunks;
    const mimeType = this._recordMimeType;
    this._recordChunks = [];
    this._isRecording = false;

    if (chunks.length === 0) {
      this.updateDomState();
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    let duration = 0;
    try {
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      duration = decoded.duration;
      ctx.close();
    } catch {
      // fall back to wall-clock time
      duration = this._currentTime;
    }

    this.setAudioData(bytes, 'recording.webm', duration, mimeType);
  }

  // --- Playback ---

  private togglePlayback(): void {
    if (this._isPlaying) {
      this.pausePlayback();
    } else {
      this.startPlayback();
    }
  }

  private startPlayback(): void {
    const data = this._audioData;
    if (!data) {
      return;
    }

    if (!this._audioEl) {
      const audio = new Audio();
      audio.addEventListener('ended', () => {
        this._isPlaying = false;
        this._currentTime = 0;
        audio.currentTime = 0;
        this.updateDomState();
      });
      this._audioEl = audio;
    }

    if (!this._objectUrl) {
      const type = this._mimeType || undefined;
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const blob = new Blob([buf], type ? { type } : undefined);
      this._objectUrl = URL.createObjectURL(blob);
      this._audioEl.src = this._objectUrl;
    }

    this._isPlaying = true;
    this._audioEl.play().catch(() => {
      this._isPlaying = false;
      this.updateDomState();
    });
    this.updateDomState();
  }

  private pausePlayback(): void {
    this._audioEl?.pause();
    this._isPlaying = false;
    this.updateDomState();
  }

  private resetPlayback(): void {
    if (this._audioEl) {
      this._audioEl.pause();
      this._audioEl = null;
    }
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
    this._isPlaying = false;
    this._currentTime = 0;
    this._lastRenderedProgress = -1;
  }

  // --- Waveform ---

  private scheduleWaveformDecode(): void {
    const data = this._audioData;
    if (!data || data === this._waveformForData) {
      return;
    }
    this._waveformForData = data;
    this._waveform = null;
    this._lastRenderedProgress = -1;

    decodeWaveform(data)
      .then((wf) => {
        if (data !== this._audioData) {
          return;
        }
        this._waveform = wf;
        this._lastRenderedProgress = -1;
        this.redrawWaveformProgress();
      })
      .catch(() => {});
  }
}
