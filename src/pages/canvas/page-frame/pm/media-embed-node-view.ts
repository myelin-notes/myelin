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

    this.dom.className = `pm-media-embed pm-media-embed--${kind}`;
    if (shouldPreserveMediaEmbedFocus(kind)) {
      this.dom.setAttribute('data-page-frame-preserve-focus', 'true');
      this.dom.setAttribute('contenteditable', 'false');
    } else {
      this.dom.removeAttribute('data-page-frame-preserve-focus');
      this.dom.removeAttribute('contenteditable');
    }
    this.dom.replaceChildren();

    const body = document.createElement(kind === 'video' ? 'video' : 'img');
    body.className = 'pm-media-embed__body';
    body.setAttribute('draggable', 'false');
    body.setAttribute('data-embed-src', src);
    if (title) {
      body.setAttribute('title', title);
    }

    if (kind === 'video' && body instanceof HTMLVideoElement) {
      body.setAttribute('data-page-frame-preserve-focus', 'true');
      body.setAttribute('contenteditable', 'false');
      body.controls = true;
      body.preload = 'metadata';
      body.playsInline = true;
      body.src = src;
    } else if (body instanceof HTMLImageElement) {
      body.alt = alt;
      body.loading = 'lazy';
      body.decoding = 'async';
      body.src = src;
    }

    applyEmbedDimensions(body, width, height);
    this.dom.appendChild(body);
  }
}
