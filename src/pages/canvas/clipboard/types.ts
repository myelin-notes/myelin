import type * as Y from 'yjs';
import type { ElementType } from '../elements/element-type';

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasClipboardSnapshot {
  version: 1;
  sourceNoteId: string;
  selectionBounds: CanvasRect;
  payload: string;
}

export interface CanvasClipboardSelectionItem {
  index: number;
  type: ElementType;
  bounds: CanvasRect;
  yMap: Y.Map<unknown>;
  pageFrameFragment?: Y.XmlFragment | null;
}

export interface CanvasClipboardSelection {
  noteId: string;
  bounds: CanvasRect;
  items: CanvasClipboardSelectionItem[];
}

export interface CanvasPasteContext {
  noteId: string;
  viewportCenter: CanvasPoint;
}

export interface CanvasPastePlacement {
  translate: CanvasPoint;
  pasteCount: number;
}

export interface CanvasPasteResult {
  pastedElementIndices: number[];
}

export interface CanvasClipboardPort {
  isEditing(): boolean;
  getSelection(): CanvasClipboardSelection | null;
  getPasteContext(): CanvasPasteContext | null;
  deleteSelection(): void;
  pasteSnapshot(
    snapshot: CanvasClipboardSnapshot,
    placement: CanvasPastePlacement,
  ): CanvasPasteResult | null;
}
