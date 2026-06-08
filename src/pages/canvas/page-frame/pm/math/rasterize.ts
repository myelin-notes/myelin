import { toCanvas } from 'html-to-image';
import { renderKatex } from './render';

/**
 * Rasterize a block formula to a canvas. KaTeX has no vector/SVG output, so the
 * only way math reaches a PDF or a 2D thumbnail is to render the HTML and snap
 * it to a bitmap — the same approach code blocks use for export
 * (page-frame-harvest.ts). Returns null for empty source or on capture failure.
 *
 * The probe is styled by the global `.canvas-latex-block` rules (canvas-latex.css):
 * zeroed `.katex-display` margin and a left-aligned, transparent box, so the
 * raster hugs the formula and overlays cleanly.
 */
export async function rasterizeKatex(
  latex: string,
  pixelRatio: number,
): Promise<HTMLCanvasElement | null> {
  if (!latex.trim()) {
    return null;
  }

  const node = document.createElement('div');
  node.className = 'canvas-latex-block';
  Object.assign(node.style, {
    position: 'absolute',
    left: '-100000px',
    top: '0',
    width: 'max-content',
    background: 'transparent',
  } as Partial<CSSStyleDeclaration>);
  node.appendChild(renderKatex(latex, true));
  document.body.appendChild(node);

  try {
    // KaTeX glyphs are web fonts; without this the first export can capture
    // fallback metrics.
    await document.fonts?.ready?.catch(() => undefined);
    return await toCanvas(node, { pixelRatio, backgroundColor: undefined });
  } catch {
    return null;
  } finally {
    node.remove();
  }
}
