import { Plugin, PluginKey } from 'prosemirror-state';
import { DecorationSet, type EditorView } from 'prosemirror-view';
import type { PageLayout } from '../../../elements/page-frame-constants';
import { PM_ADD_TO_HISTORY } from '../constants';
import { type Break, PAGE_BREAK_GAP } from './core';
import {
  buildPaginationDecorations,
  syncBlockquoteRuleStyles,
} from './decoration-renderer';
import { observePaginationInvalidations } from './invalidation-controller';
import { calculatePaginationLayout } from './layout-calculator';
import { collectPaginationBlocks } from './line-measurer';
import { paginationProfiler } from './profiler';

const SETTLE_PASS_COUNT = 4;

interface PaginationState {
  decos: DecorationSet;
  breaks: Break[];
  pageCount: number;
}

const paginationKey = new PluginKey<PaginationState>('pagination');

// Spacer heights come from sub-pixel measurements and wobble between passes. Exact float
// equality reads that noise as a layout change, so the settle loop never converges. Real layout
// changes move spacers by at least a line height.
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

// scrollWidth exactly equal to N*stride - gap can drift up by ε, flipping ceil() from N to N+1.
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
            // One uninterrupted strip: report the editor's natural height so the frame can size its single
            // sheet, and clear any breaks left from a previous paginated layout.
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
          const blocks = collectPaginationBlocks(editorView, editorOffsetTop);
          if (metrics) {
            metrics.collectBlocksMs =
              performance.now() - collectBlocksStartedAt;
            metrics.blocks = blocks.length;
          }
          if (blocks.length === 0) {
            return;
          }

          // Ancestor `transform: scale(zoom)` makes getClientRects coords scaled; offsetWidth is unscaled
          // CSS width. Width, not height, to avoid divide-by-zero on a 0-height empty doc.
          const screenRect = editorView.dom.getBoundingClientRect();
          const cssWidth = editorView.dom.offsetWidth;
          const invScale = cssWidth > 0 ? cssWidth / screenRect.width : 1;
          const editorScreenTop = screenRect.top;

          const calculateLayoutStartedAt = metrics ? performance.now() : 0;
          const { breaks, pageCount } = calculatePaginationLayout(
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
          const decos = buildPaginationDecorations(editorView, breaks);
          if (metrics) {
            metrics.buildDecorationsMs =
              performance.now() - buildDecorationsStartedAt;
          }

          const tr = editorView.state.tr;
          tr.setMeta(paginationKey, { decos, breaks, pageCount });
          tr.setMeta(PM_ADD_TO_HISTORY, false);

          // Spacer widgets mutate the editor height and can trip the ResizeObserver. Ignore that
          // self-induced resize for one frame and rely on the bounded settle loop below.
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

          // The first pass often measures an unpaginated DOM and then mutates it. Run a bounded number of
          // follow-up frames so reopen-time layout converges without waiting for a keystroke.
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

      // The doc can stay unchanged while the DOM settles underneath it (web fonts swap in, node views
      // resize). Repaginating only on PM transactions leaves those stale breaks until the next edit.
      const stopObservingLayout = observePaginationInvalidations(
        editorView,
        schedule,
        () => suppressResizeInvalidation,
        SETTLE_PASS_COUNT,
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
