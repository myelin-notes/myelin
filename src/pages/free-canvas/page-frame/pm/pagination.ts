import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

const PAGE_HEIGHT = 880;
const PAGE_PADDING = 48;
const PAGE_GAP = 40;
/** Usable content height per page. */
const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_PADDING * 2; // 784
/** Vertical space consumed by a page break: bottom padding + gap + top padding. */
const PAGE_BREAK_GAP = PAGE_PADDING + PAGE_GAP + PAGE_PADDING; // 136

const CONTAINER_NODE_NAMES = new Set([
  'bulletList',
  'orderedList',
  'blockquote',
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
 * Walk a single overflowing paragraph at line granularity and emit breaks.
 *
 * This is the expensive operation: it materializes line rects via
 * `Range.getClientRects()` and may call `view.posAtCoords` once per emitted
 * break. It is only called for paragraphs whose effective bottom crosses
 * the current page boundary.
 *
 * Convergence: a paragraph that already contains widget breaks from a prior
 * pass will produce the same break set this pass, because the line rects
 * include the widget gaps and we subtract `existingShiftAt(linePos)` to
 * recover natural coordinates. The fast path (no inner widgets) uses a
 * single uniform `blockShift` and skips per-line `posAtCoords` entirely.
 */
function paginateParagraph(
  block: BlockInfo,
  view: EditorView,
  editorScreenTop: number,
  invScale: number,
  initialPageStart: number,
  initialPageBoundary: number,
  initialCumulativeShift: number,
  blockShift: number,
  hasInnerWidgets: boolean,
  existingShiftAt: (pos: number) => number,
): ParagraphPaginationResult {
  // 1. Materialize line rects from text descendants. Walking text nodes
  //    explicitly skips our own widget DOM nodes so they don't pollute the
  //    line set on subsequent passes.
  const rawRects: DOMRect[] = [];
  const walker = document.createTreeWalker(block.dom, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r.width > 0 && r.height > 0) {
        rawRects.push(r);
      }
    }
    textNode = walker.nextNode();
  }

  // 2. Group rects by visual line (multi-fragment lines share a top).
  interface Line {
    top: number;
    bottom: number;
    left: number;
  }
  const lines: Line[] = [];
  for (const r of rawRects) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(r.top - last.top) < 1) {
      if (r.bottom > last.bottom) {
        last.bottom = r.bottom;
      }
      if (r.left < last.left) {
        last.left = r.left;
      }
    } else {
      lines.push({ top: r.top, bottom: r.bottom, left: r.left });
    }
  }

  const breaks: Break[] = [];
  let pageStart = initialPageStart;
  let pageBoundary = initialPageBoundary;
  let cumulativeShift = initialCumulativeShift;
  let pageAdvances = 0;

  if (lines.length === 0) {
    return {
      breaks,
      cumulativeShift,
      pageStart,
      pageBoundary,
      pageAdvances,
    };
  }

  for (const line of lines) {
    const lineMeasuredTop = (line.top - editorScreenTop) * invScale;
    const lineMeasuredBottom = (line.bottom - editorScreenTop) * invScale;

    // Fast path: when no widgets exist inside this paragraph, every line
    // shares the same existing shift, so we can compute natural coords
    // without calling posAtCoords. This is the common case during normal
    // typing and avoids per-line DOM walks entirely.
    let lineNaturalTop: number;
    let lineNaturalBottom: number;
    if (hasInnerWidgets) {
      const result = view.posAtCoords({
        left: line.left + 1,
        top: line.top + (line.bottom - line.top) / 2,
      });
      const linePos = result?.pos ?? block.pos;
      const lineShift = existingShiftAt(linePos);
      lineNaturalTop = lineMeasuredTop - lineShift;
      lineNaturalBottom = lineMeasuredBottom - lineShift;
    } else {
      lineNaturalTop = lineMeasuredTop - blockShift;
      lineNaturalBottom = lineMeasuredBottom - blockShift;
    }

    const lineEffectiveTop = lineNaturalTop + cumulativeShift;
    const lineEffectiveBottom = lineNaturalBottom + cumulativeShift;

    if (lineEffectiveBottom <= pageBoundary) {
      continue;
    }

    // The line crosses the boundary. Emit a break unless we're already at
    // the top of the current page (oversized line / first-line case).
    if (lineEffectiveTop > pageStart) {
      const spacer = pageBoundary + PAGE_BREAK_GAP - lineEffectiveTop;
      if (spacer > 0) {
        // Now — and only now — pay for posAtCoords to anchor the break.
        const result = view.posAtCoords({
          left: line.left + 1,
          top: line.top + (line.bottom - line.top) / 2,
        });
        if (result) {
          const linePos = Math.max(
            block.pos + 2,
            Math.min(result.pos, block.pos + block.nodeSize - 1),
          );
          breaks.push({ pos: linePos, spacer, kind: 'inline' });
          cumulativeShift += spacer;
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

  function paragraphHasInnerWidgets(block: BlockInfo): boolean {
    const blockEnd = block.pos + block.nodeSize;
    for (const b of sorted) {
      if (b.kind === 'inline' && b.pos > block.pos && b.pos < blockEnd) {
        return true;
      }
    }
    return false;
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
      const result = paginateParagraph(
        block,
        view,
        editorScreenTop,
        invScale,
        pageStart,
        pageBoundary,
        cumulativeShift,
        blockShift,
        paragraphHasInnerWidgets(block),
        existingShiftAt,
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
    if (kind === 'block') {
      const node = view.state.doc.nodeAt(pos);
      if (!node) {
        continue;
      }
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, {
          style: `margin-top: ${spacer}px`,
          'data-page-break': 'block',
        }),
      );
    } else {
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
            div.setAttribute('data-page-break', 'inline');
            return div;
          },
          { side: -1, ignoreSelection: true, key: `pb-${pos}-${widgetSpacer}` },
        ),
      );
    }
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
  onPageCount: (pageCount: number) => void,
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
          onPageCount(pageCount);
        }

        const decos = buildDecorationSet(editorView, breaks);
        const tr = editorView.state.tr;
        tr.setMeta(paginationKey, { decos, breaks, pageCount });
        tr.setMeta('addToHistory', false);
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
