import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { PM_EDITOR_CLASS } from '../constants';
import { stripMathDelimiters } from './parse-math-block';
import { renderKatex } from './render';

const SOURCE_GAP = 4;
const SOURCE_SCROLL_MARGIN = 8;

/**
 * Renders a math block as a KaTeX preview plus an editable raw-source view.
 * The math preview plugin toggles `pm-math-block--editing` on the wrapper
 * (via a node decoration) when the selection is inside the block; CSS swaps
 * which of the two children is visible.
 */
export class MathBlockNodeView implements NodeView {
  dom: HTMLDivElement;
  contentDOM: HTMLElement;
  private preview: HTMLDivElement;
  private source: HTMLPreElement;
  private node: PMNode;
  // Without this the canvas pan handler swallows wheel events, so a
  // page-capped preview can never scroll. Mirrors CodeBlockEditor.handleWheel:
  // only consume the event while the block is being edited (the code block's
  // hasFocus equivalent), and never for ctrl-wheel (pinch zoom).
  private readonly handleWheel = (event: WheelEvent): void => {
    if (
      event.ctrlKey ||
      !this.dom.classList.contains('pm-math-block--editing')
    ) {
      return;
    }
    const overflowing =
      this.preview.scrollHeight > this.preview.clientHeight + 1 ||
      this.preview.scrollWidth > this.preview.clientWidth + 1;
    if (overflowing) {
      event.stopPropagation();
    }
  };

  constructor(node: PMNode) {
    this.node = node;

    this.dom = document.createElement('div');
    this.dom.className = 'pm-math-block';

    this.preview = document.createElement('div');
    this.preview.className = 'pm-math-block-preview pm-page-capped';
    this.preview.contentEditable = 'false';
    this.preview.addEventListener('wheel', this.handleWheel);

    this.source = document.createElement('pre');
    this.source.className = 'pm-math-block-source';
    this.contentDOM = document.createElement('code');
    this.source.appendChild(this.contentDOM);

    this.dom.append(this.preview, this.source);
    this.renderPreview();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    const changed = node.textContent !== this.node.textContent;
    this.node = node;
    if (changed) {
      this.renderPreview();
    }
    return true;
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection' }): boolean {
    if (mutation.type === 'selection') {
      return false;
    }
    // Attribute mutations on the source panel are positioning writes from
    // positionMathBlockSources — re-parsing them would loop: re-parse →
    // reposition → mutation → …
    if (mutation.type === 'attributes' && mutation.target === this.source) {
      return true;
    }
    return this.preview.contains(mutation.target as Node);
  }

  private renderPreview(): void {
    this.preview.replaceChildren(
      renderKatex(stripMathDelimiters(this.node.textContent), true),
    );
  }
}

/**
 * The source panel floats below its block by default, but near the end of
 * the document that would extend past the page frame — clipped by the
 * frame's overflow:hidden box, and bait for scrollIntoView to scroll the
 * frame's clip divs (shifting the whole page). Clamp it to the document's
 * extent so it overlays the end of the frame instead, like a popup.
 *
 * Called from the math preview plugin's view-update hook so it runs after
 * every DOM sync — covering selection moves, edits inside the block, and
 * the editable toggle that makes the panel visible in the first place.
 *
 * The bound is the larger of the frame's editor box and the doc element's
 * extent: the editor box covers short documents (the page is taller than
 * the content), while the doc extent covers the flush right after content
 * grows — the frame only resizes to match one rAF later.
 */
/**
 * Keep the caret visible inside the source panel's own scroller. Page frames
 * never scroll — the canvas follow-cursor pan keeps the caret on screen — so
 * the editor suppresses ProseMirror's ancestor scroll-walk entirely
 * (`handleScrollToSelection`) and this handles the one legitimate internal
 * scroller instead.
 */
export function scrollMathSourceCaretIntoView(view: EditorView): void {
  const { $head } = view.state.selection;
  if ($head.parent.type.name !== 'mathBlock') {
    return;
  }

  const block = view.nodeDOM($head.before());
  if (!(block instanceof HTMLElement)) {
    return;
  }
  const panel = block.querySelector<HTMLElement>('.pm-math-block-source');
  if (!panel || panel.scrollHeight <= panel.clientHeight) {
    return;
  }

  const rect = panel.getBoundingClientRect();
  if (rect.height === 0) {
    return;
  }
  const caret = view.coordsAtPos($head.pos);
  // Screen px → the panel's local units (canvas zoom + frame DPR zoom).
  const scale = rect.height / panel.offsetHeight;
  const margin = SOURCE_SCROLL_MARGIN * scale;
  if (caret.bottom > rect.bottom - margin) {
    panel.scrollTop += (caret.bottom - (rect.bottom - margin)) / scale;
  } else if (caret.top < rect.top + margin) {
    panel.scrollTop -= (rect.top + margin - caret.top) / scale;
  }
}

export function positionMathBlockSources(viewDom: HTMLElement): void {
  // Horizontal layout flows in columns where vertical clamping makes no
  // sense — keep the CSS default there.
  const editor = viewDom.closest<HTMLElement>(`.${PM_EDITOR_CLASS}`);
  if (!editor || editor.dataset.pageLayout === 'horizontal') {
    return;
  }

  // Frame bottom expressed in the doc element's coordinate space.
  const frameBottom = editor.clientHeight - viewDom.offsetTop - SOURCE_GAP;
  const bound = Math.max(viewDom.clientHeight, frameBottom);

  for (const panel of viewDom.querySelectorAll<HTMLElement>(
    '.pm-math-block--editing .pm-math-block-source',
  )) {
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
