import type { Node as ProseMirrorNode } from 'prosemirror-model';

export type CanvasSearchContent =
  | { kind: 'page-frame'; doc: ProseMirrorNode }
  | { kind: 'text' | 'transcript'; text: string };

export interface SearchableElement {
  getCanvasSearchContent(): CanvasSearchContent | null;
}
