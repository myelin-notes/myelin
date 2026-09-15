import type { EditorView } from 'prosemirror-view';
import type { ParagraphLine } from './core';
import type {
  PaginationBlockInfo,
  ParagraphLineMeasurement,
  ParagraphLineMeasurer,
} from './line-measurer';
import type { PaginationRunMetrics } from './profiler';

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

interface DomParagraphLineCaches {
  domLineFragments: WeakMap<HTMLElement, CachedParagraphTextLineFragments>;
  textOnlyLines: Map<number, CachedTextOnlyParagraphLines>;
  textOnlyResults: WeakMap<HTMLElement, CachedTextOnlyParagraphLineResult>;
}

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
  cache: Map<number, CachedTextOnlyParagraphLines>,
  blockPos: number,
  cacheEntry: CachedTextOnlyParagraphLines,
): void {
  cache.delete(blockPos);
  cache.set(blockPos, cacheEntry);
  if (cache.size <= MAX_TEXT_ONLY_PARAGRAPH_CACHE_ENTRIES) {
    return;
  }
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
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
  block: PaginationBlockInfo,
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

// `Range#getClientRects()` gives the visual line fragments but not which character starts each.
// Binary-search the prefix length where the rect count grows: that's the first char of the next line.
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

  // Only the horizontal line signature and recovered start offsets. The next pass still reads live
  // rect tops/bottoms, so spacer widgets can move lines vertically without invalidating this.
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

// Fallback when Pretext can't handle the block (mentions, images). Remembers the text
// node/offset starting each fragment, which ties split positions to the rendered DOM instead of
// caret hit-testing — the latter changes when the editor flips between editable and read-only.
function measureLinesWithDom(
  measurement: ParagraphLineMeasurement,
  caches: DomParagraphLineCaches,
): ParagraphLine[] {
  const {
    block,
    view,
    editorScreenTop,
    invScale,
    blockNaturalTop,
    blockShift,
    metrics,
    measurementCacheGeneration,
  } = measurement;
  const startedAt = metrics ? performance.now() : 0;

  const textOnlyParagraph = getTextOnlyParagraphInfo(view, block.pos);
  if (textOnlyParagraph) {
    const width = block.dom.clientWidth;
    const cachedLineResult = caches.textOnlyResults.get(block.dom);
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
      caches.textOnlyResults.delete(block.dom);
      if (metrics) {
        metrics.domMeasurementMs += performance.now() - startedAt;
      }
      return [];
    }

    const mergedRects = mergeVisibleTextLineRects(textNodeRects);
    let lineStartOffsets: number[];
    const cached = caches.textOnlyLines.get(block.pos);
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
        rememberTextOnlyParagraphLineCache(caches.textOnlyLines, block.pos, {
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
      caches.textOnlyResults.set(block.dom, {
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

  const cachedParagraph = caches.domLineFragments.get(block.dom);
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
    caches.domLineFragments.set(block.dom, { textNodes: nextCacheEntries });
  } else {
    caches.domLineFragments.delete(block.dom);
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

export class DomParagraphLineMeasurer implements ParagraphLineMeasurer {
  private readonly caches: DomParagraphLineCaches = {
    domLineFragments: new WeakMap(),
    textOnlyLines: new Map(),
    textOnlyResults: new WeakMap(),
  };

  public measure(measurement: ParagraphLineMeasurement): ParagraphLine[] {
    return measureLinesWithDom(measurement, this.caches);
  }
}
