import type { EditorView } from 'prosemirror-view';
import {
  type LayoutCursor,
  type LayoutLinesResult,
  layoutWithLines,
  type PreparedTextWithSegments,
  prepareWithSegments,
} from '@chenglou/pretext';
import type { ParagraphLine } from './core';
import type {
  PaginationBlockInfo,
  ParagraphLineMeasurement,
  ParagraphLineMeasurer,
} from './line-measurer';
import type { PaginationRunMetrics } from './profiler';

// For ASCII, grapheme index equals char index within a segment. Complex Unicode (emoji ZWJ,
// combining marks) may be off by a few units — acceptable for line-start placement.
function cursorToCharOffset(
  cursor: LayoutCursor,
  segments: readonly string[],
): number {
  let offset = 0;
  const end = Math.min(cursor.segmentIndex, segments.length);
  for (let i = 0; i < end; i++) {
    offset += segments[i].length;
  }
  return offset + cursor.graphemeIndex;
}

// Pure arithmetic after one `prepareWithSegments` call — no DOM reads, no `view.posAtCoords`.
// Offsets map to PM positions via `block.pos + 1 + charOffset`, valid only when the block has no
// inline atoms (mentions/images inflate node size without contributing to `textContent`).
// Returns `null` for blocks Pretext can't handle (non-text children, empty text, missing CSS).
function measureLinesWithPretext(
  block: PaginationBlockInfo,
  view: EditorView,
  blockNaturalTop: number,
  metrics: PaginationRunMetrics | null,
): ParagraphLine[] | null {
  const startedAt = metrics ? performance.now() : 0;
  if (metrics) {
    metrics.pretextMeasurementAttemptCount++;
  }

  const paragraphNode = view.state.doc.nodeAt(block.pos);
  if (!paragraphNode) {
    return null;
  }

  let hasNonText = false;
  paragraphNode.forEach((child) => {
    if (!child.isText) {
      hasNonText = true;
    }
  });
  if (hasNonText) {
    return null;
  }

  const text = paragraphNode.textContent;
  if (text.length === 0) {
    return null;
  }

  const cs = getComputedStyle(block.dom);
  const fontSize = Number.parseFloat(cs.fontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return null;
  }
  let lineHeight = Number.parseFloat(cs.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    lineHeight = fontSize * 1.5;
  }
  const fontString = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const width = block.dom.clientWidth;
  if (width <= 0) {
    return null;
  }

  let prepared: PreparedTextWithSegments;
  let layoutResult: LayoutLinesResult;
  try {
    prepared = prepareWithSegments(text, fontString);
    layoutResult = layoutWithLines(prepared, width, lineHeight);
  } catch {
    return null;
  }

  const layoutLines = layoutResult.lines;
  const lines: ParagraphLine[] = new Array(layoutLines.length);
  const contentSize = paragraphNode.content.size;
  for (let i = 0; i < layoutLines.length; i++) {
    const layoutLine = layoutLines[i];
    const naturalTop = blockNaturalTop + i * lineHeight;
    lines[i] = {
      naturalTop,
      naturalBottom: naturalTop + lineHeight,
      getPos: () => {
        const charOffset = cursorToCharOffset(
          layoutLine.start,
          prepared.segments,
        );
        const clamped = Math.max(0, Math.min(charOffset, contentSize));
        return block.pos + 1 + clamped;
      },
    };
  }
  if (metrics) {
    metrics.pretextMeasurementSuccessCount++;
    metrics.pretextMeasurementMs += performance.now() - startedAt;
  }
  return lines;
}

export class PretextParagraphLineMeasurer implements ParagraphLineMeasurer {
  public measure(measurement: ParagraphLineMeasurement): ParagraphLine[] {
    if (measurement.blockNaturalTop === null) {
      return [];
    }
    return (
      measureLinesWithPretext(
        measurement.block,
        measurement.view,
        measurement.blockNaturalTop,
        measurement.metrics,
      ) ?? []
    );
  }
}
