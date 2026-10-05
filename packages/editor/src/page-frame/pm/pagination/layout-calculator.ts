import type { EditorView } from 'prosemirror-view';
import { type Break, calculateBreakLayout } from './core';
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
  existingBreaks: Break[],
  metrics: PaginationRunMetrics | null,
  measurementCacheGeneration: number,
  paragraphLineMeasurer: ParagraphLineMeasurer,
  tableLineMeasurer: ParagraphLineMeasurer,
): { breaks: Break[]; pageCount: number } {
  return calculateBreakLayout({
    blocks,
    existingBreaks,
    measureParagraphLines: (block, state) =>
      paragraphLineMeasurer.measure({
        block,
        view,
        editorScreenTop,
        invScale,
        blockNaturalTop: state.blockNaturalTop,
        blockShift: state.blockShift,
        metrics,
        measurementCacheGeneration,
      }),
    measureTableRows: (block, state) =>
      measureTableRows(
        block,
        view,
        editorScreenTop,
        invScale,
        state.blockShift,
        tableLineMeasurer,
      ),
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
