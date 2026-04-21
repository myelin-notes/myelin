import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import {
  type LayoutCursor,
  layoutWithLines,
  prepareWithSegments,
} from '@chenglou/pretext';
import { PM_ADD_TO_HISTORY } from './constants';

const PAGE_HEIGHT = 880;
const PAGE_PADDING = 48;
const PAGE_GAP = 40;
const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_PADDING * 2; // 784
const PAGE_BREAK_GAP = PAGE_PADDING + PAGE_GAP + PAGE_PADDING; // 136

type BreakKind = 'block' | 'inline';

interface Break {
  pos: number;
  spacer: number;
  kind: BreakKind;
}

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
  isParagraph: boolean;
}

/**
 * Walk the doc and emit one BlockInfo per leaf block.
 *
 * This is the *only* DOM measurement done up-front. Paragraphs are NOT
 * expanded into per-line points here — that expensive work is deferred to
 * `paginateParagraph`, which is only called for paragraphs that actually
 * cross a page boundary.
 */
function collectBlocks(view: EditorView, editorOffsetTop: number): BlockInfo[] {
  const result: BlockInfo[] = [];

  function walk(node: PMNode, pos: number) {
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
    result.push({
      pos,
      dom,
      height,
      measuredTop: dom.offsetTop - editorOffsetTop,
      nodeSize: node.nodeSize,
      isParagraph: node.type.name === 'paragraph',
    });
  }

  view.state.doc.forEach((child, offset) => {
    walk(child, offset);
  });

  return result;
}

interface ParagraphPaginationResult {
  breaks: Break[];
  cumulativeShift: number;
  pageStart: number;
  pageBoundary: number;
  pageAdvances: number;
}

/**
 * One visual line inside a paragraph, in CSS pixels relative to the editor
 * content top, as if no pagination decorations existed. `getPos` is lazy —
 * it's only called when the pagination loop actually decides to emit a
 * break at this line, so measurers can defer any expensive DOM lookups until
 * they're actually needed.
 */
interface ParagraphLine {
  naturalTop: number;
  naturalBottom: number;
  getPos: () => number | null;
}

interface DomLineFragment {
  bottom: number;
  left: number;
  startNode: Text;
  startOffset: number;
  top: number;
}

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

/**
 * `Range#getClientRects()` tells us which visual line fragments a text node
 * occupies, but not which character starts each fragment. To recover a stable
 * doc position we binary-search the prefix length where the rect count grows:
 * that's the first visible character on the next wrapped line.
 */
function collectDomLineFragments(textNode: Text): DomLineFragment[] {
  if (textNode.length === 0) {
    return [];
  }

  const fullRange = document.createRange();
  fullRange.selectNodeContents(textNode);
  const fullRects = Array.from(fullRange.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  if (fullRects.length === 0) {
    return [];
  }

  const prefixRange = document.createRange();
  prefixRange.setStart(textNode, 0);
  const fragments: DomLineFragment[] = [];
  let searchStart = 1;

  for (let rectIndex = 0; rectIndex < fullRects.length; rectIndex++) {
    const targetRectCount = rectIndex + 1;
    let low = searchStart;
    let high = textNode.length;
    let firstVisibleEnd = textNode.length;

    while (low <= high) {
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
    fragments.push({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      startNode: textNode,
      startOffset: Math.max(0, firstVisibleEnd - 1),
    });
    searchStart = Math.min(textNode.length, firstVisibleEnd + 1);
  }

  return fragments;
}

/**
 * Walk a paragraph's line list and emit page breaks.
 *
 * This is the *only* pagination algorithm for paragraphs. It doesn't know
 * or care how the lines were measured — Pretext or DOM — it just walks
 * them in order, checks whether each one crosses the current page boundary
 * in effective coordinates (natural + accumulated shift), and emits a
 * widget break when one does.
 */
function paginateParagraph(
  lines: ParagraphLine[],
  blockPos: number,
  blockEnd: number,
  initialPageStart: number,
  initialPageBoundary: number,
  initialCumulativeShift: number,
): ParagraphPaginationResult {
  const breaks: Break[] = [];
  let pageStart = initialPageStart;
  let pageBoundary = initialPageBoundary;
  let cumulativeShift = initialCumulativeShift;
  let pageAdvances = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineEffectiveTop = line.naturalTop + cumulativeShift;
    const lineEffectiveBottom = line.naturalBottom + cumulativeShift;

    if (lineEffectiveBottom <= pageBoundary) {
      continue;
    }

    // Crosses the boundary. Emit a break unless the line is already at
    // the top of the current page (oversized/first-line case).
    if (lineEffectiveTop > pageStart) {
      const spacer = pageBoundary + PAGE_BREAK_GAP - lineEffectiveTop;
      if (spacer > 0) {
        if (lineIndex === 0) {
          // If the paragraph's first visual line doesn't fit, move the whole
          // paragraph with a block break. An inline widget at char 0 creates
          // unstable layout inside the paragraph itself.
          breaks.push({ pos: blockPos, spacer, kind: 'block' });
          cumulativeShift += spacer;
        } else {
          const pos = line.getPos();
          if (pos !== null) {
            const clamped = Math.max(blockPos + 2, Math.min(pos, blockEnd - 1));
            breaks.push({ pos: clamped, spacer, kind: 'inline' });
            cumulativeShift += spacer;
          }
        }
      }
    }

    pageStart = pageBoundary + PAGE_BREAK_GAP;
    pageBoundary = pageStart + CONTENT_HEIGHT;
    pageAdvances++;
  }

  return { breaks, cumulativeShift, pageStart, pageBoundary, pageAdvances };
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
 * Measure a paragraph's lines using Pretext's canvas-based layout.
 *
 * Pure arithmetic after a single `prepareWithSegments` call — no DOM reads
 * for line positions, no `view.posAtCoords`. Character offsets come from
 * each `LayoutLine.start` cursor and map directly to PM doc positions via
 * `block.pos + 1 + charOffset` (only valid when the paragraph contains no
 * inline atoms — mentions/images inflate node size without contributing to
 * `textContent`, which would break the mapping).
 *
 * Returns `null` for paragraphs Pretext can't handle (non-text children,
 * empty text, missing CSS inputs, or Pretext itself throwing).
 */
function measureLinesWithPretext(
  block: BlockInfo,
  view: EditorView,
  blockNaturalTop: number,
): ParagraphLine[] | null {
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

  let prepared: ReturnType<typeof prepareWithSegments>;
  let layoutResult: ReturnType<typeof layoutWithLines>;
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
  return lines;
}

/**
 * Measure a paragraph's lines using DOM range rects — the fallback when
 * Pretext can't handle the paragraph (contains mentions, images, etc.).
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
  blockShift: number,
): ParagraphLine[] {
  const rects: DomLineFragment[] = [];
  const walker = document.createTreeWalker(block.dom, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    if (textNode instanceof Text) {
      const fragments = collectDomLineFragments(textNode);
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

  if (rects.length === 0) {
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
  return lines;
}

/**
 * Measure a paragraph's lines. Prefer DOM rects so pagination follows the
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
): ParagraphLine[] {
  const fromDom = measureLinesWithDom(
    block,
    view,
    editorScreenTop,
    invScale,
    blockShift,
  );
  if (fromDom.length > 0) {
    return fromDom;
  }
  return measureLinesWithPretext(block, view, blockNaturalTop) ?? [];
}

/**
 * Walk blocks in document order and emit page breaks.
 *
 * Cheap by default: per-block this only reads `offsetTop` / `offsetHeight`
 * (which are cached layout values, not reflows). Paragraphs are only
 * line-expanded when they actually overflow the current page boundary.
 */
function calculateLayout(
  blocks: BlockInfo[],
  view: EditorView,
  editorScreenTop: number,
  invScale: number,
  existingBreaks: Break[],
): { breaks: Break[]; pageCount: number } {
  const sorted = [...existingBreaks].sort((a, b) => a.pos - b.pos);
  function existingShiftAt(pos: number): number {
    // We measure against a DOM that still contains the previous pass's spacer
    // widgets. Subtract their accumulated height to recover each block's
    // "natural" top before deciding where the next pass should break.
    let shift = 0;
    for (const b of sorted) {
      if (b.pos <= pos) {
        shift += b.spacer;
      } else {
        break;
      }
    }
    return shift;
  }

  const newBreaks: Break[] = [];
  let pageStart = 0;
  let pageBoundary = CONTENT_HEIGHT;
  let pageCount = 1;
  // Accumulates only the spacers chosen in this pass. This is distinct from
  // `blockShift`, which removes the previous pass's widgets from measurements.
  let cumulativeShift = 0;

  for (const block of blocks) {
    const blockShift = existingShiftAt(block.pos);
    const blockNaturalTop = block.measuredTop - blockShift;
    const blockEffectiveTop = blockNaturalTop + cumulativeShift;
    const blockEffectiveBottom = blockEffectiveTop + block.height;

    if (blockEffectiveBottom <= pageBoundary) {
      continue;
    }

    if (block.isParagraph && blockEffectiveTop < pageBoundary) {
      const lines = measureParagraphLines(
        block,
        view,
        editorScreenTop,
        invScale,
        blockNaturalTop,
        blockShift,
      );
      const result = paginateParagraph(
        lines,
        block.pos,
        block.pos + block.nodeSize,
        pageStart,
        pageBoundary,
        cumulativeShift,
      );
      newBreaks.push(...result.breaks);
      cumulativeShift = result.cumulativeShift;
      pageStart = result.pageStart;
      pageBoundary = result.pageBoundary;
      pageCount += result.pageAdvances;
      continue;
    }

    // Whole-block break for non-paragraphs (or paragraphs already on a new
    // page, which can be pushed atomically without splitting).
    let spacerApplied = 0;
    if (blockEffectiveTop > pageStart) {
      const spacer = pageBoundary + PAGE_BREAK_GAP - blockEffectiveTop;
      if (spacer > 0) {
        newBreaks.push({ pos: block.pos, spacer, kind: 'block' });
        cumulativeShift += spacer;
        spacerApplied = spacer;
      }
    }

    const finalBottom = blockEffectiveTop + spacerApplied + block.height;
    do {
      pageStart = pageBoundary + PAGE_BREAK_GAP;
      pageBoundary = pageStart + CONTENT_HEIGHT;
      pageCount++;
    } while (finalBottom > pageBoundary);
  }

  return { breaks: newBreaks, pageCount };
}

function buildDecorationSet(view: EditorView, breaks: Break[]): DecorationSet {
  if (breaks.length === 0) {
    return DecorationSet.empty;
  }
  const decos: Decoration[] = [];
  for (const { pos, spacer, kind } of breaks) {
    decos.push(
      Decoration.widget(
        pos,
        () => {
          const div = document.createElement('div');
          div.style.display = 'block';
          div.style.height = `${spacer}px`;
          div.style.userSelect = 'none';
          div.style.pointerEvents = 'none';
          div.contentEditable = 'false';
          div.setAttribute('data-page-break', kind);
          return div;
        },
        {
          side: -1,
          ignoreSelection: true,
          key: `pb-${kind}-${pos}-${spacer}`,
        },
      ),
    );
  }
  return DecorationSet.create(view.state.doc, decos);
}

function breaksEqual(a: Break[], b: Break[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos) {
      return false;
    }
    if (a[i].spacer !== b[i].spacer) {
      return false;
    }
    if (a[i].kind !== b[i].kind) {
      return false;
    }
  }
  return true;
}

function observeLayoutInvalidations(
  view: EditorView,
  schedule: (followUp?: boolean) => void,
): () => void {
  const cleanup: Array<() => void> = [];

  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => {
      schedule(true);
    });
    resizeObserver.observe(view.dom);
    cleanup.push(() => {
      resizeObserver.disconnect();
    });
  }

  const fontSet = document.fonts;
  const onFontsReady = () => {
    schedule(true);
  };
  const onFontLoadingDone = () => {
    schedule(true);
  };
  const onFontLoadingError = () => {
    schedule(true);
  };
  const onFocusIn = () => {
    schedule(true);
  };

  void fontSet.ready.then(onFontsReady);
  fontSet.addEventListener('loadingdone', onFontLoadingDone);
  fontSet.addEventListener('loadingerror', onFontLoadingError);
  view.dom.addEventListener('focusin', onFocusIn);
  cleanup.push(() => {
    fontSet.removeEventListener('loadingdone', onFontLoadingDone);
    fontSet.removeEventListener('loadingerror', onFontLoadingError);
    view.dom.removeEventListener('focusin', onFocusIn);
  });

  return () => {
    for (const fn of cleanup) {
      fn();
    }
  };
}

export function paginationPlugin(
  onPageCount?: (pageCount: number) => void,
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
          } else {
            try {
              const $pos = tr.doc.resolve(mapped);
              if ($pos.parent.type.name === 'paragraph') {
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
      let shouldRunFollowUp = false;

      function paginate() {
        if (destroyed) {
          return;
        }
        rafId = 0;
        const shouldQueueFollowUp = shouldRunFollowUp;
        shouldRunFollowUp = false;

        const prev = paginationKey.getState(editorView.state);
        const prevBreaks = prev?.breaks ?? [];
        const prevPageCount = prev?.pageCount ?? 1;
        const editorOffsetTop = editorView.dom.offsetTop;
        const blocks = collectBlocks(editorView, editorOffsetTop);
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

        const { breaks, pageCount } = calculateLayout(
          blocks,
          editorView,
          editorScreenTop,
          invScale,
          prevBreaks,
        );

        const changed =
          !breaksEqual(breaks, prevBreaks) || pageCount !== prevPageCount;
        if (!changed) {
          return;
        }

        if (pageCount !== prevPageCount) {
          onPageCount?.(pageCount);
        }

        const decos = buildDecorationSet(editorView, breaks);
        const tr = editorView.state.tr;
        tr.setMeta(paginationKey, { decos, breaks, pageCount });
        tr.setMeta(PM_ADD_TO_HISTORY, false);
        editorView.dispatch(tr);

        // The first pass often measures an unpaginated DOM and then mutates it
        // by inserting spacer widgets. Run one more frame against that new DOM
        // so reopen-time layout can converge without waiting for a keystroke.
        if (shouldQueueFollowUp) {
          schedule();
        }
      }

      function schedule(followUp = false) {
        shouldRunFollowUp = shouldRunFollowUp || followUp;
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
      );

      // Initial pagination after first paint.
      schedule(true);

      return {
        update(view, prevState) {
          // Skip selection-only state changes — they don't affect layout
          // and the previous pagination is still valid.
          if (view.state.doc !== prevState.doc) {
            schedule(true);
          }
        },
        destroy() {
          destroyed = true;
          stopObservingLayout();
          if (rafId !== 0) {
            cancelAnimationFrame(rafId);
          }
        },
      };
    },
  });
}
