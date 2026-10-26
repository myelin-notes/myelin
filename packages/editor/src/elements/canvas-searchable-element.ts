import type { Node as ProseMirrorNode } from 'prosemirror-model';

export type CanvasSearchContent =
  | { kind: 'page-frame'; doc: ProseMirrorNode }
  | { kind: 'text' | 'transcript'; text: string }
  // `position` is the page's place in the edited layout; `bounds` are world coordinates.
  | {
      kind: 'pdf';
      pages: { position: number; bounds: DOMRect; text: string }[];
    };

export interface SearchableElement {
  getCanvasSearchContent(): CanvasSearchContent | null;
}
