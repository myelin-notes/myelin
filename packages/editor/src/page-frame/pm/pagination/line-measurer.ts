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
  keepWithNext?: boolean;
  forcesPageBreak?: boolean;
  isEmbed?: boolean;
}

export interface ParagraphLineMeasurement {
  block: PaginationBlockInfo;
  view: EditorView;
  editorScreenTop: number;
  invScale: number;
  metrics: PaginationRunMetrics | null;
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
    const forcesPageBreak = node.type.name === 'pageBreak';
    if (height <= 0 && !forcesPageBreak) {
      return;
    }
    // mathBlock's visible content is the rendered preview; its PM text (the
    // raw source) is hidden, so inline breaks inside it would be invisible.
    const isBreakableTextBlock =
      node.isTextblock &&
      node.type.name !== 'codeBlock' &&
      node.type.name !== 'mathBlock' &&
      node.type.name !== 'figure';
    result.push({
      pos,
      dom,
      height,
      measuredTop: dom.offsetTop - editorOffsetTop,
      nodeSize: node.nodeSize,
      isBreakableTextBlock,
      isBreakableTableBlock: node.type.name === 'table',
      isPageHeightConstrained: node.type.name === 'codeBlock',
      keepWithNext: node.type.name === 'heading',
      forcesPageBreak,
    });
  });

  for (const dom of view.dom.querySelectorAll<HTMLElement>(
    ':scope > [data-page-anchor]',
  )) {
    result.push({
      pos: view.posAtDOM(dom, 0),
      dom,
      height: dom.offsetHeight,
      measuredTop: dom.offsetTop - editorOffsetTop,
      nodeSize: 0,
      isBreakableTextBlock: false,
      isBreakableTableBlock: false,
      isPageHeightConstrained: false,
    });
  }
  // Embeds are widgets, not doc nodes, so they need their own entry to break cleanly. Several at one
  // position move as a unit: a break can only go before the whole run.
  const embedsByPos = new Map<number, PaginationBlockInfo>();
  for (const dom of view.dom.querySelectorAll<HTMLElement>(
    ':scope > .pm-embed-host',
  )) {
    const pos = view.posAtDOM(dom, 0);
    const top = dom.offsetTop - editorOffsetTop;
    const existing = embedsByPos.get(pos);
    if (existing) {
      const bottom = Math.max(
        existing.measuredTop + existing.height,
        top + dom.offsetHeight,
      );
      existing.measuredTop = Math.min(existing.measuredTop, top);
      existing.height = bottom - existing.measuredTop;
      continue;
    }
    const embed: PaginationBlockInfo = {
      pos,
      dom,
      height: dom.offsetHeight,
      measuredTop: top,
      nodeSize: 0,
      isBreakableTextBlock: false,
      isBreakableTableBlock: false,
      isPageHeightConstrained: false,
      isEmbed: true,
    };
    embedsByPos.set(pos, embed);
    result.push(embed);
  }
  return result.sort((a, b) => a.pos - b.pos || a.measuredTop - b.measuredTop);
}

export { DomParagraphLineMeasurer } from './dom-line-measurer';
