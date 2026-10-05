import type { EditorView } from 'prosemirror-view';
import { CONTENT_HEIGHT } from './core';

export function observePaginationInvalidations(
  view: EditorView,
  schedule: (followUpPasses?: number) => void,
  shouldIgnoreResizeInvalidation: () => boolean,
  followUpPasses: number,
): () => void {
  const cleanup: Array<() => void> = [];
  const requestFollowUpPagination = () => {
    schedule(followUpPasses);
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

  // Switching between vertical and continuous changes no editor styles, so the ResizeObserver
  // never fires for that toggle. Watch the layout attribute directly.
  const layoutHost = view.dom.closest('.pm-editor');
  if (layoutHost instanceof HTMLElement) {
    // Single source of truth for the page-break cap: page-capped blocks in editor-blocks.css read
    // this var, so CONTENT_HEIGHT and the CSS max-height can't drift apart.
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
