import { Plugin, PluginKey } from 'prosemirror-state';
import { DecorationSet, type EditorView } from 'prosemirror-view';
import { anchorGapsKey } from '../anchoring';
import { PM_ADD_TO_HISTORY } from '../constants';
import { type Break, DEFAULT_PAGE_GEOMETRY, type PageGeometry } from './core';
import {
  buildPaginationDecorations,
  syncBlockquoteRuleStyles,
} from './decoration-renderer';
import { observePaginationInvalidations } from './invalidation-controller';
import { calculatePaginationLayout } from './layout-calculator';
import {
  collectPaginationBlocks,
  DomParagraphLineMeasurer,
} from './line-measurer';
import { paginationProfiler } from './profiler';

// Hides spacers (editor-base.css) so measurement sees the document as if unpaginated.
const MEASURING_ATTRIBUTE = 'data-page-measuring';

const paginationRunners = new WeakMap<EditorView, () => void>();

/** Runs pagination synchronously, for callers that read page count right after changing content. */
export function flushPagination(view: EditorView): void {
  paginationRunners.get(view)?.();
}

interface PaginationState {
  decos: DecorationSet;
  breaks: Break[];
  pageCount: number;
}

const paginationKey = new PluginKey<PaginationState>('pagination');

// Spacer heights come from sub-pixel measurements scaled by canvas zoom, so they carry float noise.
// Real layout changes move spacers by at least a line height.
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
    if (
      a[i].kind !== b[i].kind ||
      a[i].afterAnchorGap !== b[i].afterAnchorGap
    ) {
      return false;
    }
  }
  return true;
}

function isContinuousLayout(view: EditorView): boolean {
  return (
    view.dom.closest('.pm-editor')?.getAttribute('data-page-layout') ===
    'continuous'
  );
}

export function paginationPlugin(
  onLayout?: (pageCount: number, contentHeight: number | null) => void,
  getGeometry: () => PageGeometry = () => DEFAULT_PAGE_GEOMETRY,
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

        const decos = prev.decos.map(tr.mapping, tr.doc);
        const mappedBreaks: Break[] = [];
        for (const b of prev.breaks) {
          const mapped = tr.mapping.map(b.pos);
          // Layout ignores spacers, so a break kept without its widget would compare equal to the
          // next pass and the spacer would never be redrawn.
          if (decos.find(mapped, mapped).length === 0) {
            continue;
          }
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
          decos,
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
      const lineMeasurer = new DomParagraphLineMeasurer();
      let rafId = 0;
      let destroyed = false;
      let syncBlockquoteStylesRafId = 0;

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
        if (rafId !== 0) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }

        const prev = paginationKey.getState(editorView.state);
        const prevBreaks = prev?.breaks ?? [];
        const prevPageCount = prev?.pageCount ?? 1;
        const run = paginationProfiler.startRun(
          prevBreaks.length,
          prevPageCount,
          false,
        );
        const metrics = run?.metrics ?? null;

        try {
          if (isContinuousLayout(editorView)) {
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
            return;
          }

          const geometry = getGeometry();
          const layoutHost = editorView.dom.closest('.pm-editor');
          // Layout is a pure function of the spacer-free document. Hiding and restoring spacers in
          // one synchronous step never paints, and a single pass is final.
          layoutHost?.setAttribute(MEASURING_ATTRIBUTE, '');
          let breaks: Break[];
          let pageCount: number;
          try {
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

            const calculateLayoutStartedAt = metrics ? performance.now() : 0;
            ({ breaks, pageCount } = calculatePaginationLayout(
              blocks,
              editorView,
              screenRect.top,
              invScale,
              geometry,
              metrics,
              lineMeasurer,
            ));
            if (metrics) {
              metrics.calculateLayoutMs =
                performance.now() - calculateLayoutStartedAt;
              metrics.breakCount = breaks.length;
              metrics.pageCount = pageCount;
            }
          } finally {
            layoutHost?.removeAttribute(MEASURING_ATTRIBUTE);
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
          const decos = buildPaginationDecorations(
            editorView,
            breaks,
            geometry,
          );
          if (metrics) {
            metrics.buildDecorationsMs =
              performance.now() - buildDecorationsStartedAt;
          }

          const tr = editorView.state.tr;
          tr.setMeta(paginationKey, { decos, breaks, pageCount });
          tr.setMeta(PM_ADD_TO_HISTORY, false);

          const dispatchStartedAt = metrics ? performance.now() : 0;
          editorView.dispatch(tr);
          scheduleBlockquoteRuleSync();
          if (metrics) {
            metrics.dispatchMs = performance.now() - dispatchStartedAt;
          }
        } finally {
          run?.finish();
        }
      }

      function schedule() {
        if (!destroyed && rafId === 0) {
          rafId = requestAnimationFrame(paginate);
        }
      }

      paginationRunners.set(editorView, paginate);

      // The doc can stay unchanged while the DOM settles underneath it (web fonts swap in, node views
      // resize). Repaginating only on PM transactions leaves those stale breaks until the next edit.
      const stopObservingLayout = observePaginationInvalidations(
        editorView,
        schedule,
      );

      // Initial pagination after first paint.
      schedule();

      return {
        update(view, prevState) {
          // Skip selection-only state changes — they don't affect layout
          // and the previous pagination is still valid.
          if (
            view.state.doc !== prevState.doc ||
            anchorGapsKey.getState(view.state) !==
              anchorGapsKey.getState(prevState)
          ) {
            schedule();
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
        },
      };
    },
  });
}
