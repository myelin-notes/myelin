import type { EditorView } from 'prosemirror-view';
import { type Break, calculateBreakLayout, type PageGeometry } from './core';
import type {
  PaginationBlockInfo,
  ParagraphLineMeasurer,
} from './line-measurer';
import type { PaginationRunMetrics } from './profiler';
import { measureTableRows } from './table-measurer';

// Cheap by default: per-block this only reads cached `offsetTop`/`offsetHeight`, no reflow.
// Breakable text blocks are line-expanded only when they overflow the current page boundary.
export function calculatePaginationLayout(
  blocks: PaginationBlockInfo[],
  view: EditorView,
  editorScreenTop: number,
  invScale: number,
  geometry: PageGeometry,
  metrics: PaginationRunMetrics | null,
  lineMeasurer: ParagraphLineMeasurer,
): { breaks: Break[]; pageCount: number } {
  return calculateBreakLayout({
    blocks,
    geometry,
    measureParagraphLines: (block) =>
      lineMeasurer.measure({
        block,
        view,
        editorScreenTop,
        invScale,
        metrics,
      }),
    measureTableRows: (block) =>
      measureTableRows(block, view, editorScreenTop, invScale, lineMeasurer),
    now: metrics ? () => performance.now() : undefined,
    onOverflowingParagraph: () => {
      if (metrics) {
        metrics.overflowingParagraphCount++;
      }
    },
    onParagraphMeasured: (_block, lines) => {
      if (metrics) {
        metrics.measuredLineCount += lines.length;
      }
    },
    onParagraphPaginated: (_block, _result, elapsedMs) => {
      if (metrics) {
        metrics.paragraphPaginationCount++;
        metrics.paragraphPaginationMs += elapsedMs;
      }
    },
    onOverflowingBlock: () => {
      if (metrics) {
        metrics.overflowingBlockCount++;
      }
    },
  });
}
