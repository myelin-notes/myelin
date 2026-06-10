import type { RefObject } from 'react';
import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type * as Y from 'yjs';
import type { CanvasViewport } from '../../canvas-viewport';
import { DrawableElement, ResizeHandles } from '../drawable-element';
import { ElementType } from '../element-type';
import { getFrameChromeControlsLayer } from '../frame/chrome';
import { AudioPlayerView, type AudioPlayerViewHandle } from './player-view';

const NATURAL_WIDTH = 280;
const NATURAL_HEIGHT = 72;

export class AudioElement extends DrawableElement {
  private _audioData: Uint8Array | null = null;
  private _fileName: string = '';
  private _duration: number = 0;
  private _mimeType: string = '';

  // Waveform kept for drawThumbnail — decoded lazily after audio data arrives.
  private _waveform: Float32Array | null = null;
  private _waveformForData: Uint8Array | null = null;

  private _root: HTMLDivElement | null = null;
  private _reactRoot: Root | null = null;
  private _viewRef: RefObject<AudioPlayerViewHandle | null> =
    createRef<AudioPlayerViewHandle | null>();

  // Bound once so the React component always gets a stable reference.
  private readonly _onRecorded = (
    data: Uint8Array,
    duration: number,
    mimeType: string,
  ) => {
    this.setAudioData(data, 'recording.webm', duration, mimeType);
  };

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
        this._viewRef.current?.setAudioData(
          this._audioData,
          this._duration,
          this._mimeType,
        );
        this.scheduleWaveformDecode();
      },
    });
  }

  public get audioData(): Uint8Array | null {
    return this._audioData;
  }
  public get duration(): number {
    return this._duration;
  }

  /** Called by the React component after recording, and by the media import handler. */
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
    this._viewRef.current?.setAudioData(this._audioData, duration, mimeType);
    this.scheduleWaveformDecode();
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
      drawWaveformToCanvas(ctx, wf, NATURAL_WIDTH - 64, NATURAL_HEIGHT, 0);
      ctx.restore();
    }

    ctx.fillStyle = '#2f3e46';
    ctx.beginPath();
    ctx.arc(28, NATURAL_HEIGHT / 2, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  public override syncDOM(viewport: CanvasViewport, host: HTMLElement): void {
    const root = this._root ?? this.mountReact(host);

    const zoom = viewport.zoom;
    const screen = viewport.worldToScreen({
      x: this.offset.x,
      y: this.offset.y,
    });
    root.style.left = `${screen.x}px`;
    root.style.top = `${screen.y}px`;
    root.style.transform = `scale(${this._scale.x * zoom}, ${this._scale.y * zoom})`;
  }

  public override disposeDOM(): void {
    this._reactRoot?.unmount();
    this._root?.remove();
    this._root = null;
    this._reactRoot = null;
  }

  private mountReact(host: HTMLElement): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'canvas-audio-block';
    root.dataset.elementUuid = this.uuid;
    (getFrameChromeControlsLayer() ?? host).appendChild(root);
    this._root = root;

    this._reactRoot = createRoot(root);
    flushSync(() => {
      this._reactRoot!.render(
        <AudioPlayerView ref={this._viewRef} onRecorded={this._onRecorded} />,
      );
    });

    // Push any audio data that arrived from Yjs before the DOM was created.
    if (this._audioData) {
      this._viewRef.current?.setAudioData(
        this._audioData,
        this._duration,
        this._mimeType,
      );
    }

    return root;
  }

  private scheduleWaveformDecode(): void {
    const data = this._audioData;
    if (!data || data === this._waveformForData) {
      return;
    }
    this._waveformForData = data;
    this._waveform = null;

    const ctx = new AudioContext();
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    );
    ctx
      .decodeAudioData(buffer as ArrayBuffer)
      .then((decoded) => {
        ctx.close();
        if (data !== this._audioData) {
          return;
        }
        const channel = decoded.getChannelData(0);
        const bars = 80;
        const samplesPerBar = Math.max(1, Math.floor(channel.length / bars));
        const result = new Float32Array(bars);
        for (let i = 0; i < bars; i++) {
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
        this._waveform = result;
      })
      .catch(() => {
        ctx.close();
      });
  }
}

function drawWaveformToCanvas(
  ctx: CanvasRenderingContext2D,
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
    ctx.fillStyle = x + barW < cx ? '#2f3e46' : '#d0d5db';
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 1);
    ctx.fill();
  }
}
