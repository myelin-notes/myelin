import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type * as Y from 'yjs';
import { getCanvasPalette } from '../../canvas-theme';
import type { CanvasViewport } from '../../canvas-viewport';
import { I18nProvider } from '../../i18n';
import type { LivePeer, LivePeersSnapshot } from '../../sync/live/peers';
import { ASYNC_RESULT_ORIGIN } from '../../ydoc-manager';
import { DrawableElement, ResizeHandles } from '../drawable-element';
import { ElementType } from '../element-type';
import { getFrameChromeControlsLayer } from '../frame/chrome';
import { AudioPlayerView } from './player-view';
import { decodeAudio, drawWaveform } from './waveform';

export const AUDIO_NATURAL_WIDTH = 280;
export const AUDIO_NATURAL_HEIGHT = 64;

/** Stable fallback so renders without a live session don't churn props. */
const NO_REMOTE_PEERS: readonly LivePeer[] = [];

/** e.g. 'audio/webm;codecs=opus' → 'recording.webm', 'audio/mp4' → 'recording.m4a' */
function recordingFileName(mimeType: string): string {
  const subtype = mimeType.split(';')[0]?.split('/')[1] ?? '';
  const ext = subtype === 'mp4' ? 'm4a' : subtype;
  return ext ? `recording.${ext}` : 'recording';
}

export class AudioElement extends DrawableElement {
  private _audioData: Uint8Array | null = null;
  private _fileName: string = '';
  private _duration: number = 0;
  private _mimeType: string = '';
  private _transcript: string = '';
  private _creatorPeerId: string;
  private _localPeerId: string;
  private _transcribingPeerId: string = '';
  private _livePeers: LivePeersSnapshot | null = null;

  // Decoded lazily after audio data arrives; rendered into the view as a
  // prop and used by drawThumbnail.
  private _waveform: Float32Array | null = null;
  private _waveformForData: Uint8Array | null = null;

  private _root: HTMLDivElement | null = null;
  private _reactRoot: Root | null = null;

  // Bound once so the React component always gets a stable reference.
  // The transcript follows separately via _onTranscribed once whisper
  // finishes, so the recording is usable immediately.
  private readonly _onRecorded = (
    data: Uint8Array,
    duration: number,
    mimeType: string,
    waveform: Float32Array | null,
  ) => {
    this.setAudioData(
      data,
      recordingFileName(mimeType),
      duration,
      mimeType,
      waveform,
    );
  };

  private readonly _onTranscribed = (transcript: string) => {
    this.setTranscript(transcript);
  };

  private readonly _onTranscriptionClaimed = () => {
    this.claimTranscription();
  };

  private readonly _onTranscriptionClaimReleased = () => {
    this.releaseTranscriptionClaim();
  };

  constructor(uuid: string, localPeerId = '', creatorPeerId = localPeerId) {
    super(uuid, ElementType.AUDIO);
    this._localPeerId = localPeerId;
    this._creatorPeerId = creatorPeerId;
  }

  public override getYMapProps(): Record<string, unknown> {
    const props: Record<string, unknown> = {
      fileName: this._fileName,
      duration: this._duration,
      mimeType: this._mimeType,
      transcript: this._transcript,
      creatorPeerId: this._creatorPeerId,
      transcribingPeerId: this._transcribingPeerId,
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
        this.render();
      },
      creatorPeerId: (v) => {
        this._creatorPeerId = typeof v === 'string' ? v : '';
        this.render();
      },
      transcribingPeerId: (v) => {
        this._transcribingPeerId = typeof v === 'string' ? v : '';
        this.render();
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
  public get creatorPeerId(): string {
    return this._creatorPeerId;
  }
  public get transcript(): string {
    return this._transcript;
  }
  public get transcribingPeerId(): string {
    return this._transcribingPeerId;
  }

  public setLocalPeerId(peerId: string): void {
    if (this._localPeerId === peerId) {
      return;
    }
    this._localPeerId = peerId;
    this.render();
  }

  /** Latest live-session membership, fed in by the canvas from the app's sync layer. */
  public setLivePeers(snapshot: LivePeersSnapshot | null): void {
    if (this._livePeers === snapshot) {
      return;
    }
    this._livePeers = snapshot;
    this.render();
  }

  /**
   * Write the transcription claim: this peer is transcribing (or about to).
   * Written the moment transcription starts on both the live-recording and
   * on-demand paths, so other capable peers don't self-elect meanwhile.
   */
  public claimTranscription(): void {
    if (!this._localPeerId) {
      return;
    }
    this._transcribingPeerId = this._localPeerId;
    // Like the transcript itself, claim writes arrive outside any user edit
    // and must not enter the undo stack.
    this.syncToYMap(
      { transcribingPeerId: this._localPeerId },
      ASYNC_RESULT_ORIGIN,
    );
    this.render();
  }

  /**
   * Clear our own claim after a job ends without a transcript (failure or no
   * speech), so present-but-idle doesn't read as "still transcribing" to
   * remote peers. Successful jobs skip this: a claim is inert once
   * `transcript` is set.
   */
  public releaseTranscriptionClaim(): void {
    if (
      this._transcribingPeerId.length === 0 ||
      this._transcribingPeerId !== this._localPeerId
    ) {
      return;
    }
    this._transcribingPeerId = '';
    this.syncToYMap({ transcribingPeerId: '' }, ASYNC_RESULT_ORIGIN);
    this.render();
  }

  private get isCreatedByLocalPeer(): boolean {
    return (
      this._creatorPeerId.length > 0 &&
      this._creatorPeerId === this._localPeerId
    );
  }

  /**
   * Called by the React component after recording, and by the media import
   * handler. Both callers just decoded the bytes, so they pass the waveform
   * along rather than triggering a second full decode here.
   */
  public setAudioData(
    data: Uint8Array,
    fileName: string,
    duration: number,
    mimeType: string,
    waveform: Float32Array | null,
  ): void {
    this._audioData = new Uint8Array(data);
    this._fileName = fileName;
    this._duration = duration;
    this._mimeType = mimeType;
    this._transcript = '';
    this.syncToYMap({
      audioData: this._audioData,
      fileName,
      duration,
      mimeType,
      transcript: '',
    });
    if (waveform) {
      this._waveform = waveform;
      this._waveformForData = this._audioData;
    } else {
      this.scheduleWaveformDecode();
    }
    this.render();
  }

  /** Called by the player view once on-demand transcription completes. */
  public setTranscript(transcript: string): void {
    this._transcript = transcript;
    // This lands seconds or minutes after the click that triggered it, so it
    // must not be undoable or merge into the undo capture window of whatever
    // the user is editing when it arrives.
    this.syncToYMap({ transcript }, ASYNC_RESULT_ORIGIN);
    this.render();
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
    const palette = getCanvasPalette();
    ctx.save();
    ctx.fillStyle = palette.surface;
    ctx.beginPath();
    ctx.roundRect(0, 0, AUDIO_NATURAL_WIDTH, AUDIO_NATURAL_HEIGHT, 10);
    ctx.fill();

    ctx.strokeStyle = palette.border;
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

    ctx.fillStyle = palette.accentDark;
    ctx.beginPath();
    ctx.arc(28, AUDIO_NATURAL_HEIGHT / 2, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  public override syncDOM(viewport: CanvasViewport, host: HTMLElement): void {
    const root = this._root ?? this.mountReact(host);

    const zoom = viewport.zoom;
    const scaleX = this._scale.x * zoom;
    const scaleY = this._scale.y * zoom;
    const visualScale = Math.max(
      0.05,
      (Math.abs(scaleX) + Math.abs(scaleY)) / 2,
    );
    const screen = viewport.worldToScreen({
      x: this.offset.x,
      y: this.offset.y,
    });
    root.style.left = `${screen.x}px`;
    root.style.top = `${screen.y}px`;
    const width = `${AUDIO_NATURAL_WIDTH * Math.abs(scaleX)}px`;
    if (root.style.width !== width) {
      root.style.width = width;
    }
    const height = `${AUDIO_NATURAL_HEIGHT * Math.abs(scaleY)}px`;
    if (root.style.height !== height) {
      root.style.height = height;
    }
    const scale = `${visualScale}`;
    if (root.style.getPropertyValue('--canvas-audio-scale') !== scale) {
      root.style.setProperty('--canvas-audio-scale', scale);
    }
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
            transcript={this._transcript}
            isCreator={this.isCreatedByLocalPeer}
            transcribingPeerId={this._transcribingPeerId}
            localPeerId={this._localPeerId}
            localMode={this._livePeers?.localMode ?? 'owner-device'}
            remotePeers={this._livePeers?.peers ?? NO_REMOTE_PEERS}
            onRecorded={this._onRecorded}
            onTranscribed={this._onTranscribed}
            onTranscriptionClaimed={this._onTranscriptionClaimed}
            onTranscriptionClaimReleased={this._onTranscriptionClaimReleased}
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
        this.requestRedraw();
      })
      .catch(() => {});
  }
}
