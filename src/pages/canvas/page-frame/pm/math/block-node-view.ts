import type { Node as PMNode } from 'prosemirror-model';
import type { NodeView } from 'prosemirror-view';
import { stripMathDelimiters } from './parse-math-block';
import { renderKatex } from './render';

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
  private node: PMNode;

  constructor(node: PMNode) {
    this.node = node;

    this.dom = document.createElement('div');
    this.dom.className = 'pm-math-block';

    this.preview = document.createElement('div');
    this.preview.className = 'pm-math-block-preview pm-page-capped';
    this.preview.contentEditable = 'false';

    const source = document.createElement('pre');
    source.className = 'pm-math-block-source';
    this.contentDOM = document.createElement('code');
    source.appendChild(this.contentDOM);

    this.dom.append(this.preview, source);
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
    return (
      mutation.type !== 'selection' &&
      this.preview.contains(mutation.target as Node)
    );
  }

  private renderPreview(): void {
    this.preview.replaceChildren(
      renderKatex(stripMathDelimiters(this.node.textContent), true),
    );
  }
}
