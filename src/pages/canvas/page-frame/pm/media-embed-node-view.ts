import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

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
    element.style.height = `${height}px`;
  } else {
    element.style.removeProperty('height');
  }
}

export function shouldPreserveMediaEmbedFocus(kind: string): boolean {
  return kind === 'video';
}

export function shouldStopMediaEmbedEvent(
  kind: string,
  containsTarget: boolean,
): boolean {
  return containsTarget && shouldPreserveMediaEmbedFocus(kind);
}

export class MediaEmbedNodeView implements NodeView {
  public readonly dom = document.createElement('div');
  private body: HTMLImageElement | HTMLVideoElement | null = null;

  constructor(
    private node: PMNode,
    _view: EditorView,
  ) {
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

  public ignoreMutation(): boolean {
    return true;
  }

  public stopEvent(event: Event): boolean {
    const target = event.target;
    const containsTarget = target instanceof Node && this.dom.contains(target);
    return shouldStopMediaEmbedEvent(
      (this.node.attrs.kind as string) ?? 'image',
      containsTarget,
    );
  }

  private render(): void {
    const kind = (this.node.attrs.kind as string) ?? 'image';
    const src = (this.node.attrs.src as string) ?? '';
    const alt = (this.node.attrs.alt as string | null) ?? '';
    const title = (this.node.attrs.title as string | null) ?? null;
    const width = (this.node.attrs.width as number | null) ?? null;
    const height = (this.node.attrs.height as number | null) ?? null;

    const className = `pm-media-embed pm-media-embed--${kind}`;
    if (this.dom.className !== className) {
      this.dom.className = className;
    }
    if (shouldPreserveMediaEmbedFocus(kind)) {
      this.dom.setAttribute('data-page-frame-preserve-focus', 'true');
      this.dom.setAttribute('contenteditable', 'false');
    } else {
      this.dom.removeAttribute('data-page-frame-preserve-focus');
      this.dom.removeAttribute('contenteditable');
    }

    const expectedTag = kind === 'video' ? 'video' : 'img';
    let body = this.body;
    if (!body || body.tagName.toLowerCase() !== expectedTag) {
      this.dom.replaceChildren();
      body = document.createElement(expectedTag) as
        | HTMLImageElement
        | HTMLVideoElement;
      body.className = 'pm-media-embed__body';
      body.setAttribute('draggable', 'false');
      if (body instanceof HTMLVideoElement) {
        body.setAttribute('data-page-frame-preserve-focus', 'true');
        body.setAttribute('contenteditable', 'false');
        body.controls = true;
        body.preload = 'metadata';
        body.playsInline = true;
      } else if (body instanceof HTMLImageElement) {
        body.loading = 'lazy';
        body.decoding = 'async';
      }
      this.dom.appendChild(body);
      this.body = body;
    }

    // Setting .src to the same value reloads the media (and resets video
    // playback); gate on data-embed-src so unrelated attr changes don't
    // restart it.
    if (body.getAttribute('data-embed-src') !== src) {
      body.setAttribute('data-embed-src', src);
      body.src = src;
    }

    if (title) {
      if (body.getAttribute('title') !== title) {
        body.setAttribute('title', title);
      }
    } else if (body.hasAttribute('title')) {
      body.removeAttribute('title');
    }

    if (body instanceof HTMLImageElement && body.alt !== alt) {
      body.alt = alt;
    }

    applyEmbedDimensions(body, width, height);
  }
}
