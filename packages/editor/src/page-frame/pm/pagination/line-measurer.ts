import type { EditorView } from 'prosemirror-view';
import type { ParagraphLine } from './core';
import type { PaginationRunMetrics } from './profiler';

export interface PaginationBlockInfo {
  pos: number;
  dom: HTMLElement;
  /** offsetHeight in CSS px (immune to ancestor `transform: scale`). */
  height: number;
  /** offsetTop relative to the editor's content top, in CSS px. */
  measuredTop: number;
  nodeSize: number;
  isBreakableTextBlock: boolean;
  isBreakableTableBlock: boolean;
  isPageHeightConstrained: boolean;
}

export interface ParagraphLineMeasurement {
  block: PaginationBlockInfo;
  view: EditorView;
  editorScreenTop: number;
  invScale: number;
  blockNaturalTop: number | null;
  blockShift: number;
  metrics: PaginationRunMetrics | null;
  measurementCacheGeneration: number;
}

export interface ParagraphLineMeasurer {
  measure(measurement: ParagraphLineMeasurement): ParagraphLine[];
}

// The *only* up-front DOM measurement. Breakable text blocks are not expanded into per-line
// points here — deferred to `paginateParagraph` for blocks that actually cross a boundary.
export function collectPaginationBlocks(
  view: EditorView,
  editorOffsetTop: number,
): PaginationBlockInfo[] {
  const result: PaginationBlockInfo[] = [];
  view.state.doc.forEach((node, pos) => {
    if (!node.isBlock) {
      return;
    }
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) {
      return;
    }
    const height = dom.offsetHeight;
    if (height <= 0) {
      return;
    }
    // mathBlock's visible content is the rendered preview; its PM text (the
    // raw source) is hidden, so inline breaks inside it would be invisible.
    const isBreakableTextBlock =
      node.isTextblock &&
      node.type.name !== 'codeBlock' &&
      node.type.name !== 'mathBlock';
    result.push({
      pos,
      dom,
      height,
      measuredTop: dom.offsetTop - editorOffsetTop,
      nodeSize: node.nodeSize,
      isBreakableTextBlock,
      isBreakableTableBlock: node.type.name === 'table',
      isPageHeightConstrained: node.type.name === 'codeBlock',
    });
  });

  return result;
}

export { BrowserParagraphLineMeasurer } from './browser-line-measurer';
export { DomParagraphLineMeasurer } from './dom-line-measurer';
export { PretextParagraphLineMeasurer } from './pretext-line-measurer';
