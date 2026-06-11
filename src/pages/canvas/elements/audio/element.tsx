import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type * as Y from 'yjs';
import { I18nProvider } from '@/lib/i18n';
import type { CanvasViewport } from '../../canvas-viewport';
import { DrawableElement, ResizeHandles } from '../drawable-element';
import { ElementType } from '../element-type';
import { getFrameChromeControlsLayer } from '../frame/chrome';
import { AudioPlayerView, decodeAudio, drawWaveform } from './player-view';

export const AUDIO_NATURAL_WIDTH = 280;
export const AUDIO_NATURAL_HEIGHT = 64;

export class AudioElement extends DrawableElement {
  private _audioData: Uint8Array | null = null;
  private _fileName: string = '';
  private _duration: number = 0;
  private _mimeType: string = '';
  private _transcript: string = '';

  // Decoded lazily after audio data arrives; rendered into the view as a
  // prop and used by drawThumbnail.
  private _waveform: Float32Array | null = null;
  private _waveformForData: Uint8Array | null = null;

  private _root: HTMLDivElement | null = null;
  private _reactRoot: Root | null = null;

  // Bound once so the React component always gets a stable reference.
  private readonly _onRecorded = (
    data: Uint8Array,
    duration: number,
    mimeType: string,
    transcript: string,
  ) => {
    this.setAudioData(data, 'recording.webm', duration, mimeType, transcript);
  };

  constructor(uuid: string) {
    super(uuid, ElementType.AUDIO);
  }

  public override getYMapProps(): Record<string, unknown> {
    const props: Record<string, unknown> = {
      fileName: this._fileName,
      duration: this._duration,
      mimeType: this._mimeType,
      transcript: this._transcript,
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
        this.render();
      },
      mimeType: (v) => {
        this._mimeType = typeof v === 'string' ? v : '';
        this.render();
      },
      transcript: (v) => {
        this._transcript = typeof v === 'string' ? v : '';
      },
      audioData: (v) => {
        this._audioData = v instanceof Uint8Array ? new Uint8Array(v) : null;
        this.scheduleWaveformDecode();
        this.render();
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
    transcript: string = '',
  ): void {
    this._audioData = new Uint8Array(data);
    this._fileName = fileName;
    this._duration = duration;
    this._mimeType = mimeType;
    this._transcript = transcript;
    this.syncToYMap({
      audioData: this._audioData,
      fileName,
      duration,
      mimeType,
      transcript,
    });
    this.scheduleWaveformDecode();
    this.render();
  }

  /** Called by the media import handler once file transcription completes. */
  public setTranscript(transcript: string): void {
    this._transcript = transcript;
    this.syncToYMap({ transcript });
  }

  public override get resizeHandles(): ResizeHandles {
    return ResizeHandles.Corners;
  }

  public override get maintainAspectRatio(): boolean {
    return true;
  }

  public get localBoundingBox(): DOMRect {
    return new DOMRect(0, 0, AUDIO_NATURAL_WIDTH, AUDIO_NATURAL_HEIGHT);
  }

  protected isOverLocal(x: number, y: number): boolean {
    return (
      x >= 0 && x <= AUDIO_NATURAL_WIDTH && y >= 0 && y <= AUDIO_NATURAL_HEIGHT
    );
  }

  protected updateBoundingBox(): void {}

  // DOM-backed; 2D canvas draw is a no-op.
  protected draw2D(): void {}

  public override drawThumbnail(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(0, 0, AUDIO_NATURAL_WIDTH, AUDIO_NATURAL_HEIGHT, 10);
    ctx.fill();

    ctx.strokeStyle = 'rgba(195, 199, 202, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, AUDIO_NATURAL_WIDTH, AUDIO_NATURAL_HEIGHT, 10);
    ctx.stroke();

    const wf = this._waveform;
    if (wf) {
      ctx.save();
      ctx.translate(52, 0);
      drawWaveform(ctx, wf, AUDIO_NATURAL_WIDTH - 64, AUDIO_NATURAL_HEIGHT, 0);
      ctx.restore();
    }

    ctx.fillStyle = '#1c2738';
    ctx.beginPath();
    ctx.arc(28, AUDIO_NATURAL_HEIGHT / 2, 16, 0, Math.PI * 2);
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
    this.render();

    return root;
  }

  /** No-op until the React root is mounted lazily in syncDOM. */
  private render(): void {
    if (!this._reactRoot) {
      return;
    }
    flushSync(() => {
      this._reactRoot!.render(
        <I18nProvider>
          <AudioPlayerView
            elementId={this.uuid}
            audioBytes={this._audioData}
            duration={this._duration}
            mimeType={this._mimeType}
            waveform={this._waveform}
            onRecorded={this._onRecorded}
          />
        </I18nProvider>,
      );
    });
  }

  private scheduleWaveformDecode(): void {
    const data = this._audioData;
    if (!data || data === this._waveformForData) {
      return;
    }
    this._waveformForData = data;
    this._waveform = null;

    decodeAudio(data)
      .then(({ waveform }) => {
        if (data !== this._audioData) {
          return;
        }
        this._waveform = waveform;
        this.render();
      })
      .catch(() => {});
  }
}
