import type { EditorView } from 'prosemirror-view';

export const PAGE_GEOMETRY_ATTRIBUTE = 'data-page-geometry';

export function observePaginationInvalidations(
  view: EditorView,
  schedule: () => void,
): () => void {
  const cleanup: Array<() => void> = [];

  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => {
      schedule();
    });
    resizeObserver.observe(view.dom);
    cleanup.push(() => {
      resizeObserver.disconnect();
    });
  }

  // Switching layout or page size changes no editor height until pagination runs, so the
  // ResizeObserver never fires for it. Watch the attributes directly.
  const layoutHost = view.dom.closest('.pm-editor');
  if (layoutHost && typeof MutationObserver !== 'undefined') {
    const layoutObserver = new MutationObserver(() => {
      schedule();
    });
    layoutObserver.observe(layoutHost, {
      attributes: true,
      attributeFilter: ['data-page-layout', PAGE_GEOMETRY_ATTRIBUTE],
    });
    cleanup.push(() => {
      layoutObserver.disconnect();
    });
  }

  const fontSet = document.fonts;
  const onFontsChanged = () => {
    schedule();
  };

  void fontSet.ready.then(onFontsChanged);
  fontSet.addEventListener('loadingdone', onFontsChanged);
  fontSet.addEventListener('loadingerror', onFontsChanged);
  view.dom.addEventListener('focusin', onFontsChanged);
  cleanup.push(() => {
    fontSet.removeEventListener('loadingdone', onFontsChanged);
    fontSet.removeEventListener('loadingerror', onFontsChanged);
    view.dom.removeEventListener('focusin', onFontsChanged);
  });

  return () => {
    for (const fn of cleanup) {
      fn();
    }
  };
}
