import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { TableMap } from 'prosemirror-tables';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import {
  type LayoutCursor,
  type LayoutLinesResult,
  layoutWithLines,
  type PreparedTextWithSegments,
  prepareWithSegments,
} from '@chenglou/pretext';
import type { PageLayout } from '../../../elements/page-frame-constants';
import { PM_ADD_TO_HISTORY } from '../constants';
import {
  type Break,
  CONTENT_HEIGHT,
  calculateBreakLayout,
  PAGE_BREAK_GAP,
  PAGE_GAP,
  PAGE_PADDING,
  type ParagraphLine,
  type TableRowLine,
} from './core';
import { type PaginationRunMetrics, paginationProfiler } from './profiler';

const SETTLE_PASS_COUNT = 4;

interface PaginationState {
  decos: DecorationSet;
  breaks: Break[];
  pageCount: number;
}

const paginationKey = new PluginKey<PaginationState>('pagination');

interface BlockInfo {
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

/**
 * Walk the doc and emit one BlockInfo per leaf block.
 *
 * This is the *only* DOM measurement done up-front. Breakable text blocks are NOT
 * expanded into per-line points here — that expensive work is deferred to
 * `paginateParagraph`, which is only called for text blocks that actually
 * cross a page boundary.
 */
function collectBlocks(view: EditorView, editorOffsetTop: number): BlockInfo[] {
  const result: BlockInfo[] = [];
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

interface DomLineFragment {
  bottom: number;
  left: number;
  startNode: Text;
  startOffset: number;
  top: number;
}

interface CachedTextLineFragments {
  rectSignature: Array<{ left: number; width: number }>;
  startOffsets: number[];
  text: string;
}

interface CachedParagraphTextLineFragments {
  textNodes: CachedTextLineFragments[];
}

interface CollectedDomLineFragments {
  cacheEntry: CachedTextLineFragments;
  fragments: DomLineFragment[];
}

interface TextOnlyParagraphInfo {
  contentSize: number;
  text: string;
}

interface VisibleTextNodeRects {
  rects: DOMRect[];
  textNode: Text;
  textOffsetBase: number;
}

interface MergedTextLineRect {
  bottom: number;
  left: number;
  right: number;
  startCharOffset: number | null;
  top: number;
}

interface CachedTextOnlyParagraphLines {
  contentSize: number;
  lineStartOffsets: number[];
  rectSignature: Array<{ left: number; width: number }>;
  text: string;
  width: number;
}

interface CachedTextOnlyParagraphLineBox {
  charOffset: number;
  relativeBottom: number;
  relativeTop: number;
}

interface CachedTextOnlyParagraphLineResult {
  contentSize: number;
  generation: number;
  height: number;
  lineBoxes: CachedTextOnlyParagraphLineBox[];
  text: string;
  width: number;
}

const domLineFragmentCache = new WeakMap<
  HTMLElement,
  CachedParagraphTextLineFragments
>();
const textOnlyParagraphLineCache = new Map<
  number,
  CachedTextOnlyParagraphLines
>();
const textOnlyParagraphLineResultCache = new WeakMap<
  HTMLElement,
  CachedTextOnlyParagraphLineResult
>();
const MAX_TEXT_ONLY_PARAGRAPH_CACHE_ENTRIES = 200;

function countVisibleRects(rects: DOMRectList | DOMRect[]): number {
  let count = 0;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (rect.width > 0 && rect.height > 0) {
      count++;
    }
  }
  return count;
}

function canReuseCachedDomLineFragments(
  text: string,
  fullRects: DOMRect[],
  cached: CachedTextLineFragments | undefined,
): cached is CachedTextLineFragments {
  if (!cached || cached.text !== text) {
    return false;
  }
  if (
    cached.startOffsets.length !== fullRects.length ||
    cached.rectSignature.length !== fullRects.length
  ) {
    return false;
  }
  for (let i = 0; i < fullRects.length; i++) {
    const rect = fullRects[i];
    const signature = cached.rectSignature[i];
    if (
      Math.abs(rect.left - signature.left) > 0.5 ||
      Math.abs(rect.width - signature.width) > 0.5
    ) {
      return false;
    }
  }
  return true;
}

function getTextOnlyParagraphInfo(
  view: EditorView,
  blockPos: number,
): TextOnlyParagraphInfo | null {
  const paragraphNode = view.state.doc.nodeAt(blockPos);
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

  return {
    text: paragraphNode.textContent,
    contentSize: paragraphNode.content.size,
  };
}

function collectVisibleTextNodeRects(
  blockDom: HTMLElement,
  metrics: PaginationRunMetrics | null,
): VisibleTextNodeRects[] {
  const fullRange = document.createRange();
  const result: VisibleTextNodeRects[] = [];
  const walker = document.createTreeWalker(blockDom, NodeFilter.SHOW_TEXT);
  let textOffsetBase = 0;
  let textNode = walker.nextNode();

  while (textNode) {
    if (textNode instanceof Text && textNode.length > 0) {
      if (metrics) {
        metrics.domTextNodeCount++;
      }
      fullRange.selectNodeContents(textNode);
      const rects = Array.from(fullRange.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      if (metrics) {
        metrics.domFragmentCount += rects.length;
      }
      if (rects.length > 0) {
        result.push({
          textNode,
          textOffsetBase,
          rects,
        });
      }
      textOffsetBase += textNode.data.length;
    }
    textNode = walker.nextNode();
  }

  return result;
}

function mergeVisibleTextLineRects(
  textNodeRects: VisibleTextNodeRects[],
  startOffsetsByEntry?: number[][],
): MergedTextLineRect[] {
  const result: MergedTextLineRect[] = [];

  for (let entryIndex = 0; entryIndex < textNodeRects.length; entryIndex++) {
    const entry = textNodeRects[entryIndex];
    for (let rectIndex = 0; rectIndex < entry.rects.length; rectIndex++) {
      const rect = entry.rects[rectIndex];
      const last = result[result.length - 1];
      const startCharOffset = startOffsetsByEntry
        ? entry.textOffsetBase + startOffsetsByEntry[entryIndex][rectIndex]
        : null;
      if (last && Math.abs(rect.top - last.top) < 1) {
        if (rect.bottom > last.bottom) {
          last.bottom = rect.bottom;
        }
        if (rect.left < last.left) {
          last.left = rect.left;
        }
        const right = rect.left + rect.width;
        if (right > last.right) {
          last.right = right;
        }
      } else {
        result.push({
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.left + rect.width,
          startCharOffset,
        });
      }
    }
  }

  return result;
}

function computeVisibleTextLineStartOffsets(
  entry: VisibleTextNodeRects,
  metrics: PaginationRunMetrics | null,
): number[] {
  const prefixRange = document.createRange();
  prefixRange.setStart(entry.textNode, 0);
  const startOffsets: number[] = [];
  let searchStart = 1;

  for (let rectIndex = 0; rectIndex < entry.rects.length; rectIndex++) {
    const targetRectCount = rectIndex + 1;
    let low = searchStart;
    let high = entry.textNode.length;
    let firstVisibleEnd = entry.textNode.length;

    while (low <= high) {
      if (metrics) {
        metrics.domBinarySearchStepCount++;
      }
      const mid = Math.floor((low + high) / 2);
      prefixRange.setEnd(entry.textNode, mid);
      if (countVisibleRects(prefixRange.getClientRects()) >= targetRectCount) {
        firstVisibleEnd = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    const startOffset = Math.max(0, firstVisibleEnd - 1);
    startOffsets.push(startOffset);
    searchStart = Math.min(entry.textNode.length, firstVisibleEnd + 1);
  }

  return startOffsets;
}

function canReuseTextOnlyParagraphLineCache(
  cached: CachedTextOnlyParagraphLines | undefined,
  paragraph: TextOnlyParagraphInfo,
  width: number,
  rects: MergedTextLineRect[],
): cached is CachedTextOnlyParagraphLines {
  if (!cached || cached.text !== paragraph.text) {
    return false;
  }
  if (Math.abs(cached.width - width) > 0.5) {
    return false;
  }
  if (
    cached.lineStartOffsets.length !== rects.length ||
    cached.rectSignature.length !== rects.length
  ) {
    return false;
  }
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    const signature = cached.rectSignature[i];
    if (
      Math.abs(rect.left - signature.left) > 0.5 ||
      Math.abs(rect.right - rect.left - signature.width) > 0.5
    ) {
      return false;
    }
  }
  return true;
}

function rememberTextOnlyParagraphLineCache(
  blockPos: number,
  cacheEntry: CachedTextOnlyParagraphLines,
): void {
  textOnlyParagraphLineCache.delete(blockPos);
  textOnlyParagraphLineCache.set(blockPos, cacheEntry);
  if (
    textOnlyParagraphLineCache.size <= MAX_TEXT_ONLY_PARAGRAPH_CACHE_ENTRIES
  ) {
    return;
  }
  const oldestKey = textOnlyParagraphLineCache.keys().next().value;
  if (oldestKey !== undefined) {
    textOnlyParagraphLineCache.delete(oldestKey);
  }
}

function canReuseTextOnlyParagraphLineResultCache(
  cached: CachedTextOnlyParagraphLineResult | undefined,
  paragraph: TextOnlyParagraphInfo,
  generation: number,
  width: number,
  height: number,
): cached is CachedTextOnlyParagraphLineResult {
  if (
    !cached ||
    cached.generation !== generation ||
    cached.text !== paragraph.text ||
    cached.contentSize !== paragraph.contentSize ||
    cached.lineBoxes.length === 0
  ) {
    return false;
  }
  return (
    Math.abs(cached.width - width) <= 0.5 &&
    Math.abs(cached.height - height) <= 0.5
  );
}

function linesFromCachedTextOnlyParagraphLineResult(
  cached: CachedTextOnlyParagraphLineResult,
  block: BlockInfo,
  blockNaturalTop: number,
): ParagraphLine[] {
  return cached.lineBoxes.map((lineBox) => ({
    naturalTop: blockNaturalTop + lineBox.relativeTop,
    naturalBottom: blockNaturalTop + lineBox.relativeBottom,
    getPos: () =>
      block.pos +
      1 +
      Math.max(0, Math.min(lineBox.charOffset, cached.contentSize)),
  }));
}

/**
 * `Range#getClientRects()` tells us which visual line fragments a text node
 * occupies, but not which character starts each fragment. To recover a stable
 * doc position we binary-search the prefix length where the rect count grows:
 * that's the first visible character on the next wrapped line.
 */
function collectDomLineFragments(
  textNode: Text,
  metrics: PaginationRunMetrics | null,
  cachedEntry: CachedTextLineFragments | undefined,
): CollectedDomLineFragments {
  if (metrics) {
    metrics.domTextNodeCount++;
  }

  const text = textNode.data;
  const fullRange = document.createRange();
  fullRange.selectNodeContents(textNode);
  const fullRects = Array.from(fullRange.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  if (canReuseCachedDomLineFragments(text, fullRects, cachedEntry)) {
    const fragments = fullRects.map((rect, index) => ({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      startNode: textNode,
      startOffset: cachedEntry.startOffsets[index],
    }));
    if (metrics) {
      metrics.domFragmentCount += fragments.length;
    }
    return { fragments, cacheEntry: cachedEntry };
  }

  const prefixRange = document.createRange();
  prefixRange.setStart(textNode, 0);
  const fragments: DomLineFragment[] = [];
  const startOffsets: number[] = [];
  let searchStart = 1;

  for (let rectIndex = 0; rectIndex < fullRects.length; rectIndex++) {
    const targetRectCount = rectIndex + 1;
    let low = searchStart;
    let high = textNode.length;
    let firstVisibleEnd = textNode.length;

    while (low <= high) {
      if (metrics) {
        metrics.domBinarySearchStepCount++;
      }
      const mid = Math.floor((low + high) / 2);
      prefixRange.setEnd(textNode, mid);
      if (countVisibleRects(prefixRange.getClientRects()) >= targetRectCount) {
        firstVisibleEnd = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    const rect = fullRects[rectIndex];
    const startOffset = Math.max(0, firstVisibleEnd - 1);
    fragments.push({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      startNode: textNode,
      startOffset,
    });
    startOffsets.push(startOffset);
    searchStart = Math.min(textNode.length, firstVisibleEnd + 1);
  }

  // Cache only the horizontal line signature and the recovered start offsets.
  // The next pass still reads live rect tops/bottoms, so spacer widgets can
  // move lines vertically without invalidating the cached char positions.
  const nextCacheEntry = {
    text: textNode.data,
    startOffsets,
    rectSignature: fullRects.map((rect) => ({
      left: rect.left,
      width: rect.width,
    })),
  };

  if (metrics) {
    metrics.domFragmentCount += fragments.length;
  }

  return { fragments, cacheEntry: nextCacheEntry };
}

/**
 * Convert a Pretext layout cursor into a character offset. For ASCII text,
 * grapheme index equals char index within a segment; summing segment
 * lengths gives the global offset. Complex Unicode (emoji ZWJ, combining
 * marks) may be off by a few units — acceptable for line-start placement.
 */
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

/**
 * Measure a text block's lines using Pretext's canvas-based layout.
 *
 * Pure arithmetic after a single `prepareWithSegments` call — no DOM reads
 * for line positions, no `view.posAtCoords`. Character offsets come from
 * each `LayoutLine.start` cursor and map directly to PM doc positions via
 * `block.pos + 1 + charOffset` (only valid when the text block contains no
 * inline atoms — mentions/images inflate node size without contributing to
 * `textContent`, which would break the mapping).
 *
 * Returns `null` for text blocks Pretext can't handle (non-text children,
 * empty text, missing CSS inputs, or Pretext itself throwing).
 */
function measureLinesWithPretext(
  block: BlockInfo,
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

/**
 * Measure a text block's lines using DOM range rects — the fallback when
 * Pretext can't handle the block (contains mentions, images, etc.).
 *
 * Walks text descendants, collects one rect per visual line, and remembers
 * the text node/offset that starts each fragment. That keeps split positions
 * tied to the rendered DOM instead of caret hit-testing, which changes when
 * the editor flips between editable and read-only modes.
 */
function measureLinesWithDom(
  block: BlockInfo,
  view: EditorView,
  editorScreenTop: number,
  invScale: number,
  blockNaturalTop: number | null,
  blockShift: number,
  metrics: PaginationRunMetrics | null,
  measurementCacheGeneration: number | null,
): ParagraphLine[] {
  const startedAt = metrics ? performance.now() : 0;

  const textOnlyParagraph = getTextOnlyParagraphInfo(view, block.pos);
  if (textOnlyParagraph) {
    const width = block.dom.clientWidth;
    const cachedLineResult = textOnlyParagraphLineResultCache.get(block.dom);
    if (
      blockNaturalTop !== null &&
      measurementCacheGeneration !== null &&
      width > 0 &&
      canReuseTextOnlyParagraphLineResultCache(
        cachedLineResult,
        textOnlyParagraph,
        measurementCacheGeneration,
        width,
        block.height,
      )
    ) {
      return linesFromCachedTextOnlyParagraphLineResult(
        cachedLineResult,
        block,
        blockNaturalTop,
      );
    }

    if (metrics) {
      metrics.domMeasurementAttemptCount++;
    }

    const textNodeRects = collectVisibleTextNodeRects(block.dom, metrics);
    if (textNodeRects.length === 0) {
      textOnlyParagraphLineResultCache.delete(block.dom);
      if (metrics) {
        metrics.domMeasurementMs += performance.now() - startedAt;
      }
      return [];
    }

    const mergedRects = mergeVisibleTextLineRects(textNodeRects);
    let lineStartOffsets: number[];
    const cached = textOnlyParagraphLineCache.get(block.pos);
    if (
      width > 0 &&
      canReuseTextOnlyParagraphLineCache(
        cached,
        textOnlyParagraph,
        width,
        mergedRects,
      )
    ) {
      lineStartOffsets = cached.lineStartOffsets;
    } else {
      const startOffsetsByEntry = textNodeRects.map((entry) =>
        computeVisibleTextLineStartOffsets(entry, metrics),
      );
      lineStartOffsets = mergeVisibleTextLineRects(
        textNodeRects,
        startOffsetsByEntry,
      ).map((rect) => rect.startCharOffset ?? 0);
      if (width > 0 && lineStartOffsets.length === mergedRects.length) {
        // Text-only paragraphs can safely reuse PM char offsets even when
        // ProseMirror recreates the DOM text nodes between pagination passes.
        rememberTextOnlyParagraphLineCache(block.pos, {
          text: textOnlyParagraph.text,
          contentSize: textOnlyParagraph.contentSize,
          width,
          lineStartOffsets,
          rectSignature: mergedRects.map((rect) => ({
            left: rect.left,
            width: rect.right - rect.left,
          })),
        });
      }
    }

    let lineSpacing = 0;
    if (mergedRects.length >= 3) {
      let min = Number.POSITIVE_INFINITY;
      for (let i = 1; i < mergedRects.length; i++) {
        const gap = mergedRects[i].top - mergedRects[i - 1].top;
        if (gap > 0 && gap < min) {
          min = gap;
        }
      }
      if (Number.isFinite(min)) {
        lineSpacing = min;
      }
    }
    if (lineSpacing <= 0) {
      const cs = getComputedStyle(block.dom);
      const parsed = Number.parseFloat(cs.lineHeight);
      if (Number.isFinite(parsed) && parsed > 0) {
        lineSpacing = parsed / invScale;
      } else {
        lineSpacing = mergedRects[0].bottom - mergedRects[0].top;
      }
    }
    const tolerance = 1;

    const lines: ParagraphLine[] = new Array(mergedRects.length);
    const lineBoxes: CachedTextOnlyParagraphLineBox[] = new Array(
      mergedRects.length,
    );
    let innerShiftViewport = 0;
    let prevTop = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < mergedRects.length; i++) {
      const rect = mergedRects[i];
      if (prevTop !== Number.NEGATIVE_INFINITY) {
        const excess = rect.top - prevTop - lineSpacing;
        if (excess > tolerance) {
          innerShiftViewport += excess;
        }
      }
      prevTop = rect.top;

      const measuredTop = (rect.top - editorScreenTop) * invScale;
      const measuredBottom = (rect.bottom - editorScreenTop) * invScale;
      const totalExistingShift = blockShift + innerShiftViewport * invScale;
      const charOffset = lineStartOffsets[i] ?? 0;
      const naturalTop = measuredTop - totalExistingShift;
      const naturalBottom = measuredBottom - totalExistingShift;

      lines[i] = {
        naturalTop,
        naturalBottom,
        getPos: () =>
          block.pos +
          1 +
          Math.max(0, Math.min(charOffset, textOnlyParagraph.contentSize)),
      };
      lineBoxes[i] = {
        charOffset,
        relativeTop:
          blockNaturalTop === null ? 0 : naturalTop - blockNaturalTop,
        relativeBottom:
          blockNaturalTop === null ? 0 : naturalBottom - blockNaturalTop,
      };
    }

    if (
      blockNaturalTop !== null &&
      measurementCacheGeneration !== null &&
      width > 0
    ) {
      textOnlyParagraphLineResultCache.set(block.dom, {
        text: textOnlyParagraph.text,
        contentSize: textOnlyParagraph.contentSize,
        generation: measurementCacheGeneration,
        width,
        height: block.height,
        lineBoxes,
      });
    }
    if (metrics) {
      metrics.domMeasurementSuccessCount++;
      metrics.domMeasurementMs += performance.now() - startedAt;
    }
    return lines;
  }

  if (metrics) {
    metrics.domMeasurementAttemptCount++;
  }

  const cachedParagraph = domLineFragmentCache.get(block.dom);
  const nextCacheEntries: CachedTextLineFragments[] = [];
  const rects: DomLineFragment[] = [];
  const walker = document.createTreeWalker(block.dom, NodeFilter.SHOW_TEXT);
  let textNodeIndex = 0;
  let textNode = walker.nextNode();
  while (textNode) {
    if (textNode instanceof Text && textNode.length > 0) {
      const { fragments, cacheEntry } = collectDomLineFragments(
        textNode,
        metrics,
        cachedParagraph?.textNodes[textNodeIndex],
      );
      nextCacheEntries.push(cacheEntry);
      textNodeIndex++;
      for (const fragment of fragments) {
        const last = rects[rects.length - 1];
        if (last && Math.abs(fragment.top - last.top) < 1) {
          if (fragment.bottom > last.bottom) {
            last.bottom = fragment.bottom;
          }
          if (fragment.left < last.left) {
            last.left = fragment.left;
          }
        } else {
          rects.push(fragment);
        }
      }
    }
    textNode = walker.nextNode();
  }

  if (nextCacheEntries.length > 0) {
    domLineFragmentCache.set(block.dom, { textNodes: nextCacheEntries });
  } else {
    domLineFragmentCache.delete(block.dom);
  }

  if (rects.length === 0) {
    if (metrics) {
      metrics.domMeasurementMs += performance.now() - startedAt;
    }
    return [];
  }

  // Detect natural line spacing: the minimum adjacent gap when we have
  // enough rects, else fall back to computed CSS.
  let lineSpacing = 0;
  if (rects.length >= 3) {
    let min = Number.POSITIVE_INFINITY;
    for (let i = 1; i < rects.length; i++) {
      const gap = rects[i].top - rects[i - 1].top;
      if (gap > 0 && gap < min) {
        min = gap;
      }
    }
    if (Number.isFinite(min)) {
      lineSpacing = min;
    }
  }
  if (lineSpacing <= 0) {
    const cs = getComputedStyle(block.dom);
    const parsed = Number.parseFloat(cs.lineHeight);
    if (Number.isFinite(parsed) && parsed > 0) {
      lineSpacing = parsed / invScale; // cs is CSS px; rect gaps are viewport px
    } else {
      lineSpacing = rects[0].bottom - rects[0].top;
    }
  }
  const tolerance = 1;

  // Walk rects. Any adjacent gap larger than `lineSpacing` is a widget from
  // a prior pass; its excess contributes to cumulative inner shift.
  const lines: ParagraphLine[] = new Array(rects.length);
  let innerShiftViewport = 0;
  let prevTop = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (prevTop !== Number.NEGATIVE_INFINITY) {
      const excess = rect.top - prevTop - lineSpacing;
      if (excess > tolerance) {
        innerShiftViewport += excess;
      }
    }
    prevTop = rect.top;

    const measuredTop = (rect.top - editorScreenTop) * invScale;
    const measuredBottom = (rect.bottom - editorScreenTop) * invScale;
    const totalExistingShift = blockShift + innerShiftViewport * invScale;

    lines[i] = {
      naturalTop: measuredTop - totalExistingShift,
      naturalBottom: measuredBottom - totalExistingShift,
      getPos: () => {
        try {
          return view.posAtDOM(rect.startNode, rect.startOffset, 1);
        } catch {
          return null;
        }
      },
    };
  }
  if (metrics) {
    metrics.domMeasurementSuccessCount++;
    metrics.domMeasurementMs += performance.now() - startedAt;
  }
  return lines;
}

/**
 * Measure a text block's lines. Prefer DOM rects so pagination follows the
 * browser's actual wrapped lines. Fall back to Pretext if the DOM path can't
 * produce line boxes.
 */
function measureParagraphLines(
  block: BlockInfo,
  view: EditorView,
  editorScreenTop: number,
  invScale: number,
  blockNaturalTop: number,
  blockShift: number,
  metrics: PaginationRunMetrics | null,
  measurementCacheGeneration: number,
): ParagraphLine[] {
  if (metrics) {
    metrics.paragraphMeasurementCount++;
  }
  const fromDom = measureLinesWithDom(
    block,
    view,
    editorScreenTop,
    invScale,
    blockNaturalTop,
    blockShift,
    metrics,
    measurementCacheGeneration,
  );
  return fromDom.length > 0
    ? fromDom
    : (measureLinesWithPretext(block, view, blockNaturalTop, metrics) ?? []);
}

function isTableRowBreakElement(element: Element): boolean {
  return (
    element instanceof HTMLTableRowElement &&
    element.getAttribute('data-page-break') === 'table-row'
  );
}

function measureBreakWidgetHeight(
  element: HTMLElement,
  invScale: number,
): number {
  const rect = element.getBoundingClientRect();
  if (rect.height > 0) {
    return rect.height * invScale;
  }
  return element.offsetHeight;
}

function measureCellBreakShift(
  cell: HTMLTableCellElement,
  invScale: number,
): number {
  let shift = 0;
  for (const element of cell.querySelectorAll<HTMLElement>(
    '[data-page-break="block"], [data-page-break="inline"]',
  )) {
    shift += measureBreakWidgetHeight(element, invScale);
  }
  return shift;
}

function measureRowInternalBreakShift(
  row: HTMLTableRowElement,
  invScale: number,
): number {
  let maxCellShift = 0;
  for (const cell of Array.from(row.cells)) {
    maxCellShift = Math.max(
      maxCellShift,
      measureCellBreakShift(cell, invScale),
    );
  }
  return maxCellShift;
}

function measureCellBreakShiftBeforeBlock(
  blockDom: HTMLElement,
  invScale: number,
): number {
  const cell = blockDom.closest('td, th');
  if (!(cell instanceof HTMLTableCellElement)) {
    return 0;
  }

  const blockTop = blockDom.getBoundingClientRect().top;
  let shift = 0;
  for (const element of cell.querySelectorAll<HTMLElement>(
    '[data-page-break="block"], [data-page-break="inline"]',
  )) {
    if (element.getBoundingClientRect().bottom <= blockTop + 0.5) {
      shift += measureBreakWidgetHeight(element, invScale);
    }
  }
  return shift;
}

function collectTableRowTextBlocks(
  rowNode: PMNode,
  rowPos: number,
  view: EditorView,
): BlockInfo[] {
  const blocks: BlockInfo[] = [];

  rowNode.forEach((cell, cellOffset) => {
    const cellPos = rowPos + 1 + cellOffset;
    cell.forEach((child, childOffset) => {
      if (!child.isTextblock || child.type.name === 'codeBlock') {
        return;
      }

      const blockPos = cellPos + 1 + childOffset;
      const dom = view.nodeDOM(blockPos);
      if (!(dom instanceof HTMLElement) || dom.offsetHeight <= 0) {
        return;
      }

      blocks.push({
        pos: blockPos,
        dom,
        height: dom.offsetHeight,
        measuredTop: 0,
        nodeSize: child.nodeSize,
        isBreakableTextBlock: true,
        isBreakableTableBlock: false,
        isPageHeightConstrained: false,
      });
    });
  });

  return blocks;
}

function measureTableRowSplitLines(
  rowNode: PMNode,
  rowPos: number,
  view: EditorView,
  editorScreenTop: number,
  invScale: number,
  rowExternalShift: number,
): ParagraphLine[] {
  const lines: ParagraphLine[] = [];

  for (const block of collectTableRowTextBlocks(rowNode, rowPos, view)) {
    const cellBreakShiftBeforeBlock = measureCellBreakShiftBeforeBlock(
      block.dom,
      invScale,
    );
    lines.push(
      ...measureLinesWithDom(
        block,
        view,
        editorScreenTop,
        invScale,
        null,
        rowExternalShift + cellBreakShiftBeforeBlock,
        null,
        null,
      ),
    );
  }

  return lines.sort(
    (a, b) => a.naturalTop - b.naturalTop || a.naturalBottom - b.naturalBottom,
  );
}

function measureTableRows(
  block: BlockInfo,
  view: EditorView,
  editorScreenTop: number,
  invScale: number,
  blockShift: number,
): TableRowLine[] {
  const tableNode = view.state.doc.nodeAt(block.pos);
  if (!tableNode || tableNode.type.name !== 'table') {
    return [];
  }

  const tbody = block.dom.querySelector('tbody');
  if (!(tbody instanceof HTMLTableSectionElement)) {
    return [];
  }

  const rowInfo: Array<{ isHeaderRow: boolean; node: PMNode; pos: number }> =
    [];
  tableNode.forEach((row, offset) => {
    let cellCount = 0;
    let allHeaderCells = true;
    row.forEach((cell) => {
      cellCount++;
      if (cell.type.name !== 'table_header') {
        allHeaderCells = false;
      }
    });
    rowInfo.push({
      pos: block.pos + 1 + offset,
      node: row,
      isHeaderRow: cellCount > 0 && allHeaderCells,
    });
  });

  const rows: TableRowLine[] = [];
  let contentRowIndex = 0;
  let innerShift = 0;

  for (const child of Array.from(tbody.children)) {
    if (!(child instanceof HTMLTableRowElement)) {
      continue;
    }
    if (isTableRowBreakElement(child)) {
      innerShift += child.offsetHeight;
      continue;
    }

    const info = rowInfo[contentRowIndex];
    contentRowIndex++;
    if (info === undefined) {
      continue;
    }

    const rect = child.getBoundingClientRect();
    const measuredTop = (rect.top - editorScreenTop) * invScale;
    const measuredBottom = (rect.bottom - editorScreenTop) * invScale;
    const totalExistingShift = blockShift + innerShift;
    const rowInternalBreakShift = measureRowInternalBreakShift(child, invScale);
    const naturalTop = measuredTop - totalExistingShift;
    const naturalBottom =
      measuredBottom - totalExistingShift - rowInternalBreakShift;

    rows.push({
      naturalTop,
      naturalBottom,
      getPos: () => info.pos,
      isHeaderRow: info.isHeaderRow,
      measureSplitLines: () =>
        measureTableRowSplitLines(
          info.node,
          info.pos,
          view,
          editorScreenTop,
          invScale,
          totalExistingShift,
        ),
    });
  }

  return rows;
}

/**
 * Walk blocks in document order and emit page breaks.
 *
 * Cheap by default: per-block this only reads `offsetTop` / `offsetHeight`
 * (which are cached layout values, not reflows). Breakable text blocks are only
 * line-expanded when they actually overflow the current page boundary.
 */
function calculateLayout(
  blocks: BlockInfo[],
  view: EditorView,
  editorScreenTop: number,
  invScale: number,
  existingBreaks: Break[],
  metrics: PaginationRunMetrics | null,
  measurementCacheGeneration: number,
): { breaks: Break[]; pageCount: number } {
  return calculateBreakLayout({
    blocks,
    existingBreaks,
    measureParagraphLines: (block, state) =>
      measureParagraphLines(
        block,
        view,
        editorScreenTop,
        invScale,
        state.blockNaturalTop,
        state.blockShift,
        metrics,
        measurementCacheGeneration,
      ),
    measureTableRows: (block, state) =>
      measureTableRows(
        block,
        view,
        editorScreenTop,
        invScale,
        state.blockShift,
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

function createStandardBreakWidget(spacer: number, kind: Break['kind']): Node {
  const div = document.createElement('div');
  div.style.display = 'block';
  div.style.height = `${spacer}px`;
  div.style.userSelect = 'none';
  div.style.pointerEvents = 'none';
  div.contentEditable = 'false';
  div.setAttribute('data-page-break', kind);
  return div;
}

function syncTableCellInlineBreakGeometry(div: HTMLElement): void {
  if (!div.isConnected) {
    return;
  }

  const row = div.closest('tr');
  const table = div.closest('table');
  if (!(row instanceof HTMLTableRowElement && table instanceof HTMLElement)) {
    return;
  }

  const rowRect = row.getBoundingClientRect();
  const breakRect = div.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  const editor = div.closest('.pm-editor');
  const maskRect =
    editor instanceof HTMLElement ? editor.getBoundingClientRect() : rowRect;
  const scaleSource =
    editor instanceof HTMLElement && editor.offsetWidth > 0
      ? editor.offsetWidth
      : table.offsetWidth;
  const scaleRect = editor instanceof HTMLElement ? maskRect : tableRect;
  const scale = scaleSource > 0 ? scaleRect.width / scaleSource : 1;
  const invScale = scale > 0 ? 1 / scale : 1;

  div.style.setProperty(
    '--pm-table-cell-break-mask-left',
    `${(maskRect.left - breakRect.left) * invScale}px`,
  );
  div.style.setProperty(
    '--pm-table-cell-break-mask-width',
    `${maskRect.width * invScale}px`,
  );
  div.style.setProperty(
    '--pm-table-cell-break-border-left',
    `${(rowRect.left - breakRect.left) * invScale}px`,
  );
  div.style.setProperty(
    '--pm-table-cell-break-border-width',
    `${rowRect.width * invScale}px`,
  );
}

function createTableCellInlineBreakWidget(spacer: number): Node {
  const div = createStandardBreakWidget(spacer, 'inline') as HTMLElement;
  div.classList.add('pm-table-node__cell-page-break');

  const gapStart = Math.max(0, spacer - PAGE_BREAK_GAP + PAGE_PADDING);
  const gapEnd = Math.min(spacer, gapStart + PAGE_GAP);
  div.style.setProperty('--pm-table-cell-break-gap-start', `${gapStart}px`);
  div.style.setProperty('--pm-table-cell-break-gap-end', `${gapEnd}px`);
  div.style.setProperty('--pm-table-cell-break-height', `${spacer}px`);

  requestAnimationFrame(() => {
    syncTableCellInlineBreakGeometry(div);
  });
  return div;
}

function isPositionInsideTable(view: EditorView, pos: number): boolean {
  try {
    const $pos = view.state.doc.resolve(pos);
    for (let depth = $pos.depth; depth >= 0; depth--) {
      if ($pos.node(depth).type.name === 'table') {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function getTableColumnCountAtPos(view: EditorView, pos: number): number {
  const $pos = view.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'table') {
      return TableMap.get(node).width;
    }
  }
  return 1;
}

function createTableRowBreakWidget(
  view: EditorView,
  pos: number,
  spacer: number,
): Node {
  const row = document.createElement('tr');
  row.className = 'pm-table-node__page-break-row';
  row.contentEditable = 'false';
  row.setAttribute('data-page-break', 'table-row');

  const cell = document.createElement('td');
  cell.className = 'pm-table-node__page-break-cell';
  cell.colSpan = getTableColumnCountAtPos(view, pos);
  cell.contentEditable = 'false';

  const gap = document.createElement('div');
  gap.className = 'pm-table-node__page-break-spacer';
  gap.style.height = `${spacer}px`;
  gap.setAttribute('aria-hidden', 'true');

  cell.appendChild(gap);
  row.appendChild(cell);
  return row;
}

function buildDecorationSet(view: EditorView, breaks: Break[]): DecorationSet {
  if (breaks.length === 0) {
    return DecorationSet.empty;
  }
  return DecorationSet.create(
    view.state.doc,
    breaks.map(({ pos, spacer, kind }) =>
      Decoration.widget(
        pos,
        () =>
          kind === 'table-row'
            ? createTableRowBreakWidget(view, pos, spacer)
            : kind === 'inline' && isPositionInsideTable(view, pos)
              ? createTableCellInlineBreakWidget(spacer)
              : createStandardBreakWidget(spacer, kind),
        {
          side: -1,
          ignoreSelection: true,
          key: `pb-${kind}-${pos}-${spacer}`,
        },
      ),
    ),
  );
}

interface BlockquoteRuleSegment {
  height: number;
  top: number;
}

const BLOCKQUOTE_RULE_PROPS = [
  '--pm-blockquote-rule-images',
  '--pm-blockquote-rule-positions',
  '--pm-blockquote-rule-sizes',
  '--pm-blockquote-rule-repeats',
  '--pm-callout-fill-images',
  '--pm-callout-fill-positions',
  '--pm-callout-fill-sizes',
  '--pm-callout-fill-repeats',
] as const;

/**
 * Write only the properties that actually changed ('' means "not set").
 * This runs on every pagination pass, so unconditional writes — including
 * the old clear-then-set pattern — dirty style and force a layer flush even
 * when nothing moved.
 */
function applyBlockquoteRuleStyle(
  blockquote: HTMLElement,
  values: Record<string, string>,
): void {
  for (const prop of BLOCKQUOTE_RULE_PROPS) {
    const value = values[prop] ?? '';
    if (blockquote.style.getPropertyValue(prop) === value) {
      continue;
    }
    if (value === '') {
      blockquote.style.removeProperty(prop);
    } else {
      blockquote.style.setProperty(prop, value);
    }
  }
}

function collectBlockquoteRuleSegments(
  blockquote: HTMLElement,
): BlockquoteRuleSegment[] | null {
  const breakWidgets = Array.from(
    blockquote.querySelectorAll<HTMLElement>(
      ':scope > .ProseMirror-widget[data-page-break="inline"]',
    ),
  );
  if (breakWidgets.length === 0) {
    return null;
  }

  const segments: BlockquoteRuleSegment[] = [];
  let currentTop = 0;

  for (const widget of breakWidgets) {
    const widgetTop = widget.offsetTop;
    if (widgetTop > currentTop) {
      segments.push({ top: currentTop, height: widgetTop - currentTop });
    }
    currentTop = widgetTop + widget.offsetHeight;
  }

  const blockHeight = blockquote.offsetHeight;
  if (blockHeight > currentTop) {
    segments.push({ top: currentTop, height: blockHeight - currentTop });
  }

  return segments.filter((segment) => segment.height > 0);
}

function syncBlockquoteRuleStyles(view: EditorView): void {
  const blockquotes = view.dom.querySelectorAll<HTMLElement>('blockquote');

  for (const blockquote of blockquotes) {
    const values: Record<string, string> = {};
    const segments = collectBlockquoteRuleSegments(blockquote);
    const isCallout = blockquote.classList.contains('pm-callout');

    if (segments !== null && segments.length === 0) {
      values['--pm-blockquote-rule-images'] = 'none';
      if (isCallout) {
        values['--pm-callout-fill-images'] = 'none';
      }
    } else if (segments !== null) {
      const image =
        'linear-gradient(var(--pm-blockquote-rule-color), var(--pm-blockquote-rule-color))';
      values['--pm-blockquote-rule-images'] = segments
        .map(() => image)
        .join(', ');
      values['--pm-blockquote-rule-positions'] = segments
        .map((segment) => `0 ${segment.top}px`)
        .join(', ');
      values['--pm-blockquote-rule-sizes'] = segments
        .map((segment) => `var(--pm-blockquote-rule-width) ${segment.height}px`)
        .join(', ');
      values['--pm-blockquote-rule-repeats'] = segments
        .map(() => 'no-repeat')
        .join(', ');

      if (isCallout) {
        const calloutFillImage =
          'linear-gradient(var(--pm-callout-fill-color), var(--pm-callout-fill-color))';
        values['--pm-callout-fill-images'] = segments
          .map(() => calloutFillImage)
          .join(', ');
        values['--pm-callout-fill-positions'] = segments
          .map((segment) => `0 ${segment.top}px`)
          .join(', ');
        values['--pm-callout-fill-sizes'] = segments
          .map((segment) => `100% ${segment.height}px`)
          .join(', ');
        values['--pm-callout-fill-repeats'] = segments
          .map(() => 'no-repeat')
          .join(', ');
      }
    }

    applyBlockquoteRuleStyle(blockquote, values);
  }
}

// Spacer heights come from sub-pixel DOM measurements and wobble by
// fractions of a pixel between passes (inserting a spacer shifts the rects
// the next pass measures). Exact float equality reads that noise as a layout
// change, so the settle loop never converges and dispatches a pagination
// transaction every frame. Anything under half a pixel is visually identical;
// real layout changes move spacers by at least a line height.
const SPACER_EPSILON = 0.5;

function breaksEqual(a: Break[], b: Break[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos) {
      return false;
    }
    if (Math.abs(a[i].spacer - b[i].spacer) > SPACER_EPSILON) {
      return false;
    }
    if (a[i].kind !== b[i].kind) {
      return false;
    }
  }
  return true;
}

function getPageLayout(view: EditorView): PageLayout | null {
  const value = view.dom
    .closest('.pm-editor')
    ?.getAttribute('data-page-layout');
  return value === 'horizontal' ||
    value === 'vertical' ||
    value === 'continuous'
    ? value
    : null;
}

// scrollWidth that exactly equals N*stride - gap can drift to N*stride - gap + ε
// in floating-point, flipping ceil() from N to N+1. Shave a sub-pixel epsilon
// off the quotient before ceiling so the natural N-column width stays at N.
const PAGE_COUNT_STRIDE_EPSILON = 0.01;

function getHorizontalPageCount(view: EditorView): number {
  const columnWidth = view.dom.offsetWidth;
  if (columnWidth <= 0) {
    return 1;
  }

  const columnGap = Number.parseFloat(getComputedStyle(view.dom).columnGap);
  const gap = Number.isFinite(columnGap) ? columnGap : PAGE_BREAK_GAP;
  const stride = columnWidth + gap;
  if (stride <= 0) {
    return 1;
  }

  return Math.max(
    1,
    Math.ceil(
      (view.dom.scrollWidth + gap) / stride - PAGE_COUNT_STRIDE_EPSILON,
    ),
  );
}

function observeLayoutInvalidations(
  view: EditorView,
  schedule: (followUpPasses?: number) => void,
  shouldIgnoreResizeInvalidation: () => boolean,
): () => void {
  const cleanup: Array<() => void> = [];
  const requestFollowUpPagination = () => {
    schedule(SETTLE_PASS_COUNT);
  };

  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => {
      if (shouldIgnoreResizeInvalidation()) {
        return;
      }
      requestFollowUpPagination();
    });
    resizeObserver.observe(view.dom);
    cleanup.push(() => {
      resizeObserver.disconnect();
    });
  }

  // Switching between vertical and continuous changes no editor styles, so the
  // ResizeObserver above never fires for that toggle. Watch the layout
  // attribute directly so changing modes always triggers a fresh pass (clearing
  // or re-inserting page breaks as needed).
  const layoutHost = view.dom.closest('.pm-editor');
  if (layoutHost instanceof HTMLElement) {
    // Single source of truth for the page-break cap: page-capped blocks in
    // editor-blocks.css read this var so the CONTENT_HEIGHT constant and the
    // CSS max-height can't drift apart.
    layoutHost.style.setProperty('--pm-content-height', `${CONTENT_HEIGHT}px`);
  }
  if (layoutHost && typeof MutationObserver !== 'undefined') {
    const layoutObserver = new MutationObserver(requestFollowUpPagination);
    layoutObserver.observe(layoutHost, {
      attributes: true,
      attributeFilter: ['data-page-layout'],
    });
    cleanup.push(() => {
      layoutObserver.disconnect();
    });
  }

  const fontSet = document.fonts;

  void fontSet.ready.then(requestFollowUpPagination);
  fontSet.addEventListener('loadingdone', requestFollowUpPagination);
  fontSet.addEventListener('loadingerror', requestFollowUpPagination);
  view.dom.addEventListener('focusin', requestFollowUpPagination);
  cleanup.push(() => {
    fontSet.removeEventListener('loadingdone', requestFollowUpPagination);
    fontSet.removeEventListener('loadingerror', requestFollowUpPagination);
    view.dom.removeEventListener('focusin', requestFollowUpPagination);
  });

  return () => {
    for (const fn of cleanup) {
      fn();
    }
  };
}

export function paginationPlugin(
  onLayout?: (pageCount: number, contentHeight: number | null) => void,
): Plugin {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init() {
        return { decos: DecorationSet.empty, breaks: [], pageCount: 1 };
      },
      apply(tr, prev) {
        const next = tr.getMeta(paginationKey);
        if (next !== undefined) {
          return next as PaginationState;
        }
        if (!tr.docChanged) {
          return prev;
        }

        const mappedBreaks: Break[] = [];
        for (const b of prev.breaks) {
          const mapped = tr.mapping.map(b.pos);
          if (b.kind === 'block') {
            if (tr.doc.nodeAt(mapped)) {
              mappedBreaks.push({ ...b, pos: mapped });
            }
          } else if (b.kind === 'table-row') {
            try {
              const $pos = tr.doc.resolve(mapped);
              if ($pos.nodeAfter?.type.name === 'table_row') {
                mappedBreaks.push({ ...b, pos: mapped });
              }
            } catch {
              // dropped
            }
          } else {
            try {
              const $pos = tr.doc.resolve(mapped);
              if (
                $pos.parent.isTextblock &&
                $pos.parent.type.name !== 'codeBlock'
              ) {
                mappedBreaks.push({ ...b, pos: mapped });
              }
            } catch {
              // dropped
            }
          }
        }
        return {
          decos: prev.decos.map(tr.mapping, tr.doc),
          breaks: mappedBreaks,
          pageCount: prev.pageCount,
        };
      },
    },
    props: {
      decorations(state) {
        return paginationKey.getState(state)?.decos ?? DecorationSet.empty;
      },
    },
    view(editorView) {
      let rafId = 0;
      let destroyed = false;
      let pendingFollowUpPasses = 0;
      let suppressResizeInvalidation = false;
      let clearSuppressResizeRafId = 0;
      let syncBlockquoteStylesRafId = 0;
      let measurementCacheGeneration = 0;

      function scheduleBlockquoteRuleSync() {
        if (syncBlockquoteStylesRafId !== 0) {
          cancelAnimationFrame(syncBlockquoteStylesRafId);
        }
        syncBlockquoteStylesRafId = requestAnimationFrame(() => {
          syncBlockquoteStylesRafId = 0;
          if (!destroyed) {
            syncBlockquoteRuleStyles(editorView);
          }
        });
      }

      function paginate() {
        if (destroyed) {
          return;
        }
        rafId = 0;
        const remainingFollowUpPasses = pendingFollowUpPasses;
        pendingFollowUpPasses = 0;

        const prev = paginationKey.getState(editorView.state);
        const prevBreaks = prev?.breaks ?? [];
        const prevPageCount = prev?.pageCount ?? 1;
        const run = paginationProfiler.startRun(
          prevBreaks.length,
          prevPageCount,
          remainingFollowUpPasses > 0,
        );
        const metrics = run?.metrics ?? null;

        try {
          const pageLayout = getPageLayout(editorView);
          if (pageLayout === 'continuous') {
            // One uninterrupted strip: no page breaks. Report the editor's
            // natural height so the frame can size its single sheet, and clear
            // any breaks left over from a previous paginated layout.
            const contentHeight = editorView.dom.offsetHeight;
            onLayout?.(1, contentHeight);

            if (prevBreaks.length > 0 || prevPageCount !== 1) {
              const tr = editorView.state.tr;
              tr.setMeta(paginationKey, {
                decos: DecorationSet.empty,
                breaks: [],
                pageCount: 1,
              });
              tr.setMeta(PM_ADD_TO_HISTORY, false);
              editorView.dispatch(tr);
            }
            syncBlockquoteRuleStyles(editorView);

            if (remainingFollowUpPasses > 0) {
              schedule(remainingFollowUpPasses - 1);
            }
            return;
          }

          if (pageLayout === 'horizontal') {
            const pageCount = getHorizontalPageCount(editorView);
            const changed =
              prevBreaks.length > 0 || pageCount !== prevPageCount;
            if (!changed) {
              syncBlockquoteRuleStyles(editorView);
              return;
            }

            if (pageCount !== prevPageCount) {
              onLayout?.(pageCount, null);
            }

            const tr = editorView.state.tr;
            tr.setMeta(paginationKey, {
              decos: DecorationSet.empty,
              breaks: [],
              pageCount,
            });
            tr.setMeta(PM_ADD_TO_HISTORY, false);
            editorView.dispatch(tr);
            syncBlockquoteRuleStyles(editorView);

            if (remainingFollowUpPasses > 0) {
              schedule(remainingFollowUpPasses - 1);
            }
            return;
          }

          const editorOffsetTop = editorView.dom.offsetTop;
          const collectBlocksStartedAt = metrics ? performance.now() : 0;
          const blocks = collectBlocks(editorView, editorOffsetTop);
          if (metrics) {
            metrics.collectBlocksMs =
              performance.now() - collectBlocksStartedAt;
            metrics.blocks = blocks.length;
          }
          if (blocks.length === 0) {
            return;
          }

          // CSS↔viewport scale: ancestor `transform: scale(zoom)` makes
          // viewport coords from getClientRects scaled. offsetWidth is the
          // unscaled CSS width. Width is used (not height) to avoid
          // divide-by-zero on a 0-height empty doc.
          const screenRect = editorView.dom.getBoundingClientRect();
          const cssWidth = editorView.dom.offsetWidth;
          const invScale = cssWidth > 0 ? cssWidth / screenRect.width : 1;
          const editorScreenTop = screenRect.top;

          const calculateLayoutStartedAt = metrics ? performance.now() : 0;
          const { breaks, pageCount } = calculateLayout(
            blocks,
            editorView,
            editorScreenTop,
            invScale,
            prevBreaks,
            metrics,
            measurementCacheGeneration,
          );
          if (metrics) {
            metrics.calculateLayoutMs =
              performance.now() - calculateLayoutStartedAt;
            metrics.breakCount = breaks.length;
            metrics.pageCount = pageCount;
          }

          const changed =
            !breaksEqual(breaks, prevBreaks) || pageCount !== prevPageCount;
          if (metrics) {
            metrics.changed = changed;
          }
          if (!changed) {
            scheduleBlockquoteRuleSync();
            return;
          }

          if (pageCount !== prevPageCount) {
            onLayout?.(pageCount, null);
          }

          const buildDecorationsStartedAt = metrics ? performance.now() : 0;
          const decos = buildDecorationSet(editorView, breaks);
          if (metrics) {
            metrics.buildDecorationsMs =
              performance.now() - buildDecorationsStartedAt;
          }

          const tr = editorView.state.tr;
          tr.setMeta(paginationKey, { decos, breaks, pageCount });
          tr.setMeta(PM_ADD_TO_HISTORY, false);

          // Spacer widgets mutate the editor height and can trip the
          // ResizeObserver. Ignore that self-induced resize for one frame and
          // rely on the bounded settle loop below instead of reopening a fresh
          // full repagination chain on every dispatch.
          suppressResizeInvalidation = true;
          if (clearSuppressResizeRafId !== 0) {
            cancelAnimationFrame(clearSuppressResizeRafId);
          }
          clearSuppressResizeRafId = requestAnimationFrame(() => {
            clearSuppressResizeRafId = 0;
            suppressResizeInvalidation = false;
          });

          const dispatchStartedAt = metrics ? performance.now() : 0;
          editorView.dispatch(tr);
          scheduleBlockquoteRuleSync();
          if (metrics) {
            metrics.dispatchMs = performance.now() - dispatchStartedAt;
          }

          // The first pass often measures an unpaginated DOM and then mutates it
          // by inserting spacer widgets. Run a bounded number of follow-up
          // frames against that new DOM so reopen-time layout can converge
          // without waiting for a keystroke.
          if (remainingFollowUpPasses > 0) {
            schedule(remainingFollowUpPasses - 1);
          }
        } finally {
          run?.finish();
        }
      }

      function schedule(followUpPasses = 0) {
        if (followUpPasses >= SETTLE_PASS_COUNT) {
          measurementCacheGeneration++;
        }
        pendingFollowUpPasses = Math.max(pendingFollowUpPasses, followUpPasses);
        if (!destroyed && rafId === 0) {
          rafId = requestAnimationFrame(paginate);
        }
      }

      // Reopen-time bug source: the doc can stay unchanged while the DOM keeps
      // settling underneath it (web fonts swap in, Monaco/node views resize,
      // etc.). If we only repaginate on PM transactions, those stale breaks
      // survive until the next edit.
      const stopObservingLayout = observeLayoutInvalidations(
        editorView,
        schedule,
        () => suppressResizeInvalidation,
      );

      // Initial pagination after first paint.
      schedule(SETTLE_PASS_COUNT);

      return {
        update(view, prevState) {
          // Skip selection-only state changes — they don't affect layout
          // and the previous pagination is still valid.
          if (view.state.doc !== prevState.doc) {
            schedule(SETTLE_PASS_COUNT);
          }
        },
        destroy() {
          destroyed = true;
          stopObservingLayout();
          if (rafId !== 0) {
            cancelAnimationFrame(rafId);
          }
          if (syncBlockquoteStylesRafId !== 0) {
            cancelAnimationFrame(syncBlockquoteStylesRafId);
          }
          if (clearSuppressResizeRafId !== 0) {
            cancelAnimationFrame(clearSuppressResizeRafId);
          }
        },
      };
    },
  });
}
