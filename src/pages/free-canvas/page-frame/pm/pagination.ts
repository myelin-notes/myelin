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
const CONTAINER_NODE_NAMES = new Set([
  'bulletList',
  'orderedList',
]);

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
    if (CONTAINER_NODE_NAMES.has(node.type.name)) {
      let childPos = pos + 1;
      node.forEach((child) => {
        walk(child, childPos);
        childPos += child.nodeSize;
      });
      return;
    }
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
 * break at this line, so measurers can defer any expensive DOM lookups
 * (e.g. `view.posAtCoords`) until they're needed.
 */
interface ParagraphLine {
  naturalTop: number;
  naturalBottom: number;
  getPos: () => number | null;
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
 * Walks text descendants, collects one rect per visual line, and detects
 * widget gaps from rect spacing so `posAtCoords` is only called at the
 * break point (lazy `getPos`) rather than per line.
 */
function measureLinesWithDom(
  block: BlockInfo,
  view: EditorView,
  editorScreenTop: number,
  invScale: number,
  blockShift: number,
): ParagraphLine[] {
  interface Rect {
    top: number;
    bottom: number;
    left: number;
  }
  const rects: Rect[] = [];
  const walker = document.createTreeWalker(block.dom, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const domRects = range.getClientRects();
    for (let i = 0; i < domRects.length; i++) {
      const r = domRects[i];
      if (r.width <= 0 || r.height <= 0) {
        continue;
      }
      const last = rects[rects.length - 1];
      if (last && Math.abs(r.top - last.top) < 1) {
        if (r.bottom > last.bottom) {
          last.bottom = r.bottom;
        }
        if (r.left < last.left) {
          last.left = r.left;
        }
      } else {
        rects.push({ top: r.top, bottom: r.bottom, left: r.left });
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

    // Capture rect for the lazy getPos closure.
    const rectLeft = rect.left;
    const rectCenterY = rect.top + (rect.bottom - rect.top) / 2;
    lines[i] = {
      naturalTop: measuredTop - totalExistingShift,
      naturalBottom: measuredBottom - totalExistingShift,
      getPos: () => {
        const result = view.posAtCoords({
          left: rectLeft + 1,
          top: rectCenterY,
        });
        return result?.pos ?? null;
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
      for (const b of result.breaks) {
        newBreaks.push(b);
      }
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
    const widgetSpacer = spacer;
    decos.push(
      Decoration.widget(
        pos,
        () => {
          const div = document.createElement('div');
          div.style.display = 'block';
          div.style.height = `${widgetSpacer}px`;
          div.style.userSelect = 'none';
          div.style.pointerEvents = 'none';
          div.contentEditable = 'false';
          div.setAttribute('data-page-break', kind);
          return div;
        },
        {
          side: -1,
          ignoreSelection: true,
          key: `pb-${kind}-${pos}-${widgetSpacer}`,
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

      function paginate() {
        rafId = 0;

        const prev = paginationKey.getState(editorView.state);
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
          prev?.breaks ?? [],
        );

        const prevBreaks = prev?.breaks ?? [];
        const prevPageCount = prev?.pageCount ?? 1;
        if (breaksEqual(breaks, prevBreaks) && pageCount === prevPageCount) {
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
      }

      function schedule() {
        if (rafId === 0) {
          rafId = requestAnimationFrame(paginate);
        }
      }

      // Initial pagination after first paint.
      schedule();

      return {
        update(view, prevState) {
          // Skip selection-only state changes — they don't affect layout
          // and the previous pagination is still valid.
          if (view.state.doc !== prevState.doc) {
            schedule();
          }
        },
        destroy() {
          if (rafId !== 0) {
            cancelAnimationFrame(rafId);
          }
        },
      };
    },
  });
}
