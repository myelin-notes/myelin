import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { getThumbnailUrl, subscribeThumbnail } from '@/lib/thumbnails';

function applyEmbedDimensions(
  element: HTMLElement,
  width: number | null,
  height: number | null,
): void {
  if (typeof width === 'number' && width > 0) {
    element.style.width = `${width}px`;
  } else {
    element.style.removeProperty('width');
  }

  if (typeof height === 'number' && height > 0) {
    element.style.minHeight = `${height}px`;
  } else {
    element.style.removeProperty('min-height');
  }
}

export class NoteEmbedNodeView implements NodeView {
  public readonly dom = document.createElement('div');

  private readonly thumbnail = document.createElement('div');
  private readonly thumbnailImage = document.createElement('img');
  private readonly eyebrow = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly subtitle = document.createElement('div');
  private unsubscribeThumbnail: (() => void) | null = null;
  private destroyed = false;
  private subscribedNoteId: string | null = null;

  constructor(
    private node: PMNode,
    _view: EditorView,
  ) {
    this.dom.className = 'pm-note-embed';
    this.thumbnail.className = 'pm-note-embed__thumb';
    this.thumbnailImage.className = 'pm-note-embed__thumb-image';
    this.thumbnailImage.alt = '';
    this.thumbnailImage.ariaHidden = 'true';

    const body = document.createElement('div');
    body.className = 'pm-note-embed__body';

    this.eyebrow.className = 'pm-note-embed__eyebrow';
    this.eyebrow.textContent = 'Embedded note';

    this.title.className = 'pm-note-embed__title';
    this.subtitle.className = 'pm-note-embed__subtitle';

    this.thumbnail.appendChild(this.thumbnailImage);
    body.append(this.eyebrow, this.title, this.subtitle);
    this.dom.append(this.thumbnail, body);

    this.render();
  }

  public update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    this.node = node;
    this.render();
    return true;
  }

  public destroy(): void {
    this.destroyed = true;
    this.unsubscribeThumbnail?.();
    this.unsubscribeThumbnail = null;
  }

  public ignoreMutation(): boolean {
    return true;
  }

  private render(): void {
    const noteId = (this.node.attrs.noteId as string | null) ?? null;
    const title = ((this.node.attrs.title as string | null) ?? '').trim();
    const fragment = (this.node.attrs.fragment as string | null) ?? null;
    const width = (this.node.attrs.width as number | null) ?? null;
    const height = (this.node.attrs.height as number | null) ?? null;

    this.dom.classList.toggle('pm-note-embed--missing', noteId === null);
    applyEmbedDimensions(this.dom, width, height);

    const titleText = title.length > 0 ? title : 'Untitled note';
    if (this.title.textContent !== titleText) {
      this.title.textContent = titleText;
    }

    const subtitleText =
      fragment && fragment.length > 0
        ? fragment
        : noteId
          ? 'Preview'
          : 'Note not found';
    if (this.subtitle.textContent !== subtitleText) {
      this.subtitle.textContent = subtitleText;
    }

    if (noteId === this.subscribedNoteId) {
      return;
    }

    this.unsubscribeThumbnail?.();
    this.unsubscribeThumbnail = null;
    this.subscribedNoteId = noteId;
    this.thumbnailImage.removeAttribute('src');
    this.thumbnail.classList.remove('pm-note-embed__thumb--loaded');

    if (!noteId) {
      return;
    }

    const refresh = async () => {
      const url = await getThumbnailUrl(noteId);
      if (this.destroyed || this.subscribedNoteId !== noteId) {
        return;
      }

      if (url) {
        this.thumbnailImage.src = url;
        this.thumbnail.classList.add('pm-note-embed__thumb--loaded');
        return;
      }

      this.thumbnailImage.removeAttribute('src');
      this.thumbnail.classList.remove('pm-note-embed__thumb--loaded');
    };

    this.unsubscribeThumbnail = subscribeThumbnail(noteId, () => {
      void refresh();
    });
    void refresh();
  }
}
