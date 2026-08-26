import { PM_EDITOR_CLASS } from '../constants';

const SOURCE_GAP = 4;

/**
 * Floating source panels (math, mermaid) sit below their block, but near the end of the document
 * that extends past the page frame — clipped by its overflow:hidden box, and bait for
 * scrollIntoView to scroll the frame's clip divs. Clamp them to the document's extent instead.
 *
 * Call from each preview plugin's view-update hook so it runs after every DOM sync — selection
 * moves, edits inside the block, and the editable toggle that first makes a panel visible.
 *
 * The bound is the larger of the frame's editor box and the doc element's extent: the editor box
 * covers short documents, the doc extent covers the flush right after content grows (the frame
 * only resizes to match one rAF later).
 *
 * `panelSelector` matches the source panels of blocks currently in editing mode.
 */
export function positionBlockSourcePanels(
  viewDom: HTMLElement,
  panelSelector: string,
): void {
  // Horizontal layout flows in columns where vertical clamping makes no
  // sense — keep the CSS default there.
  const editor = viewDom.closest<HTMLElement>(`.${PM_EDITOR_CLASS}`);
  if (!editor || editor.dataset.pageLayout === 'horizontal') {
    return;
  }

  // Bail before any layout reads when nothing is editing — this runs on
  // every transaction (keystroke), and the common case has no open panel.
  const panels = viewDom.querySelectorAll<HTMLElement>(panelSelector);
  if (panels.length === 0) {
    return;
  }

  // Frame bottom expressed in the doc element's coordinate space.
  const frameBottom = editor.clientHeight - viewDom.offsetTop - SOURCE_GAP;
  const bound = Math.max(viewDom.clientHeight, frameBottom);

  for (const panel of panels) {
    const block = panel.parentElement;
    const panelHeight = panel.offsetHeight;
    if (!block || panelHeight === 0) {
      continue;
    }

    let blockTop = 0;
    for (
      let el: Element | null = block;
      el instanceof HTMLElement && el !== viewDom;
      el = el.offsetParent
    ) {
      blockTop += el.offsetTop;
    }

    const defaultTop = block.offsetHeight + SOURCE_GAP;
    const maxTop = bound - panelHeight - blockTop;
    const top = `${Math.max(Math.min(defaultTop, maxTop), -blockTop)}px`;
    if (panel.style.top !== top) {
      panel.style.top = top;
    }
  }
}
