import type * as Y from 'yjs';
import type {
  CanvasElementContext,
  CanvasUiServices,
} from './elements/canvas-element-context';
import type { DrawableElement } from './elements/drawable-element';
import { getElementDescriptor } from './elements/element-descriptors';
import type { ResolveMediaSrc } from './page-frame/pm/embed/renderer';
import type { ResolveNoteLink } from './page-frame/pm/markdown/note-links';
import type { LivePeersSnapshot } from './sync/live/peers';
import type { YDocManager } from './ydoc-manager';

export interface CanvasElementFactoryOptions {
  ydoc: YDocManager;
  getElements: () => readonly DrawableElement[];
  onChange: () => void;
  invalidateContentBounds: () => void;
  resolveNoteLink?: ResolveNoteLink;
  resolveMedia?: ResolveMediaSrc;
  localPeerId: string;
  audioRecordingOwnerId: string;
  onAudioRecordingSaved?: () => void | Promise<void>;
  uiServices?: CanvasUiServices;
}

export class CanvasElementFactory {
  private onPageFrameRenamed?: (
    uuid: string,
    newName: string,
    oldName: string,
  ) => void;
  private livePeers: LivePeersSnapshot | null = null;

  public constructor(private readonly options: CanvasElementFactoryOptions) {}

  public createFromYMap(yMap: Y.Map<unknown>): DrawableElement | null {
    const type = yMap.get('type');
    const uuid = yMap.get('uuid');
    if (typeof type !== 'number' || typeof uuid !== 'string') {
      return null;
    }
    const descriptor = getElementDescriptor(type);
    if (!descriptor) {
      return null;
    }
    const element = descriptor.create(uuid);
    this.initialize(element, yMap);
    return element;
  }

  public initialize(element: DrawableElement, yMap: Y.Map<unknown>): void {
    this.configure(element);
    element.bindToYMap(yMap);
    element.bindSharedYState(this.options.ydoc);
  }

  public setLivePeers(snapshot: LivePeersSnapshot | null): void {
    if (this.livePeers === snapshot) {
      return;
    }
    this.livePeers = snapshot;
    for (const element of this.options.getElements()) {
      this.configure(element);
    }
  }

  public setOnPageFrameRenamed(
    callback?: (uuid: string, newName: string, oldName: string) => void,
  ): void {
    this.onPageFrameRenamed = callback;
  }

  public dispose(element: DrawableElement): void {
    element.disposeCanvas();
  }

  private configure(element: DrawableElement): void {
    element.onSelectionChanged = this.options.onChange;
    element.onLockChanged = this.options.onChange;
    element.onTransformChanged = () => {
      this.options.invalidateContentBounds();
      if (element.isSelected) {
        this.options.onChange();
      }
    };
    element.configureCanvas(this.createContext());
  }

  private createContext(): CanvasElementContext {
    return {
      getElements: this.options.getElements,
      resolveNoteLink: this.options.resolveNoteLink,
      resolveMedia: this.options.resolveMedia,
      onPageFrameRenamed: (uuid, newName, oldName) => {
        this.onPageFrameRenamed?.(uuid, newName, oldName);
      },
      localPeerId: this.options.localPeerId,
      audioRecordingOwnerId: this.options.audioRecordingOwnerId,
      onAudioRecordingSaved: this.options.onAudioRecordingSaved,
      livePeers: this.livePeers,
      uiServices: this.options.uiServices,
    };
  }
}
