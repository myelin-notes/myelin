import { renderKatex } from './render';

export interface LatexProbe {
  /** The mounted, offscreen `.canvas-latex-block` node. */
  node: HTMLDivElement;
  cleanup: () => void;
}

/**
 * Mount a rendered block formula offscreen. The canvas LaTeX element sizes itself from this box
 * and its export path rasterizes it; both need the same offscreen `.canvas-latex-block` styling
 * (zeroed katex-display margin, shrink-wrapped width — canvas-latex.css) so measured and captured
 * geometry match what's painted. Keeping that styling in one place is the point.
 *
 * Returns the node plus a cleanup fn rather than taking a callback, so the synchronous measure and
 * the async rasterize can each own the node's lifetime — a `try/finally` callback would tear the
 * node down before an awaited capture resolved.
 */
export function mountLatexProbe(latex: string): LatexProbe {
  const node = document.createElement('div');
  node.className = 'canvas-latex-block';
  Object.assign(node.style, {
    position: 'absolute',
    left: '-100000px',
    top: '0',
    width: 'max-content',
  } as Partial<CSSStyleDeclaration>);
  node.appendChild(renderKatex(latex, true));
  document.body.appendChild(node);
  return { node, cleanup: () => node.remove() };
}
