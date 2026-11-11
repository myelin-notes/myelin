import type { Node as PMNode } from 'prosemirror-model';
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from 'prosemirror-view';
import { getMessages } from '../../../i18n';
import { PM_ADD_TO_HISTORY } from '../constants';
import {
  type EmbedHost,
  type ResolveMediaSrc,
  renderEmbedHost,
} from '../embed/renderer';

const MIN_WIDTH_FRACTION = 0.15;

export class FigureNodeView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private readonly media: HTMLDivElement;
  private readonly handle: HTMLDivElement;
  private embed: EmbedHost;
  private loadedAspect: number | null = null;
  private dragging = false;

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number,
    private readonly resolveMedia?: ResolveMediaSrc,
  ) {
    this.dom = document.createElement('figure');
    this.dom.className = 'pm-figure';

    this.media = document.createElement('div');
    this.media.className = 'pm-figure-media';
    this.media.contentEditable = 'false';
    this.embed = this.renderEmbed();
    this.media.appendChild(this.embed.dom);
    // `load` doesn't bubble, so this has to capture.
    this.media.addEventListener('load', this.handleMediaLoad, true);
    this.media.addEventListener('loadedmetadata', this.handleMediaLoad, true);

    this.handle = document.createElement('div');
    this.handle.className = 'pm-figure-resize';
    this.handle.addEventListener('pointerdown', this.handlePointerDown);
    this.media.appendChild(this.handle);

    this.contentDOM = document.createElement('figcaption');
    this.contentDOM.dataset.placeholder =
      getMessages().canvas.frame.figureCaptionPlaceholder;

    this.dom.append(this.media, this.contentDOM);
    this.syncFromNode();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    const sourceChanged =
      node.attrs.src !== this.node.attrs.src ||
      node.attrs.alt !== this.node.attrs.alt;
    this.node = node;
    if (sourceChanged) {
      this.embed.destroy();
      this.embed.dom.remove();
      this.embed = this.renderEmbed();
      this.media.insertBefore(this.embed.dom, this.handle);
      this.loadedAspect = null;
    }
    if (!this.dragging) {
      this.syncFromNode();
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.media.contains(event.target as Node);
  }

  ignoreMutation(record: ViewMutationRecord): boolean {
    if (record.type === 'selection') {
      return false;
    }
    return !this.contentDOM.contains(record.target);
  }

  destroy(): void {
    this.embed.destroy();
  }

  private renderEmbed(): EmbedHost {
    return renderEmbedHost(
      this.node.attrs.src as string,
      this.node.attrs.alt as string | null,
      null,
      this.resolveMedia,
    );
  }

  private syncFromNode(): void {
    this.applyWidth(this.node.attrs.width as number);
    // Reserving the box keeps page breaks still while off-screen media unloads and reloads.
    const aspect =
      (this.node.attrs.aspect as number | null) ?? this.loadedAspect;
    this.media.style.aspectRatio = aspect ? `${aspect}` : '';
    this.media.style.maxWidth = aspect
      ? `min(100%, calc(var(--pm-content-height, 784px) * ${aspect}))`
      : '';
    this.dom.classList.toggle(
      'pm-figure--uncaptioned',
      this.node.content.size === 0,
    );
  }

  private applyWidth(fraction: number): void {
    this.media.style.width = `${fraction * 100}%`;
  }

  private readonly handleMediaLoad = (event: Event): void => {
    const target = event.target;
    // A link card's favicon and thumbnail load here too, and say nothing about the figure's shape.
    if (
      !(
        target instanceof Element &&
        target.matches('.pm-embed-image, .pm-embed-video')
      )
    ) {
      return;
    }
    const [width, height] =
      target instanceof HTMLImageElement
        ? [target.naturalWidth, target.naturalHeight]
        : target instanceof HTMLVideoElement
          ? [target.videoWidth, target.videoHeight]
          : [0, 0];
    if (width <= 0 || height <= 0) {
      return;
    }
    const aspect = Math.round((width / height) * 10_000) / 10_000;
    this.loadedAspect = aspect;
    if (this.node.attrs.aspect === aspect) {
      return;
    }
    if (this.view.editable) {
      this.setAttrs({ aspect }, false);
    } else {
      this.syncFromNode();
    }
  };

  private setAttrs(
    attrs: Record<string, unknown>,
    addToHistory: boolean,
  ): void {
    const tr = this.view.state.tr.setNodeMarkup(this.getPos(), undefined, {
      ...this.node.attrs,
      ...attrs,
    });
    if (!addToHistory) {
      tr.setMeta(PM_ADD_TO_HISTORY, false);
    }
    this.view.dispatch(tr);
  }

  // Both rects are in screen px, so their ratio is independent of canvas zoom. The image is
  // centered, so the pointer's distance from the center is half its width.
  private widthFractionAt(clientX: number): number {
    const column = this.dom.getBoundingClientRect();
    const center = column.left + column.width / 2;
    const fraction = (2 * Math.abs(clientX - center)) / column.width;
    return Math.max(MIN_WIDTH_FRACTION, Math.min(1, fraction));
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.view.editable) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
    const { handle } = this;
    handle.setPointerCapture(event.pointerId);

    const onMove = (move: PointerEvent) => {
      this.applyWidth(this.widthFractionAt(move.clientX));
    };
    const finish = (end: PointerEvent) => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      this.dragging = false;
      if (end.type === 'pointerup') {
        const width =
          Math.round(this.widthFractionAt(end.clientX) * 1000) / 1000;
        this.setAttrs({ width }, true);
      } else {
        this.syncFromNode();
      }
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  };
}
