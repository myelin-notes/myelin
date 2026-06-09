import { toCanvas } from 'html-to-image';
import { mountLatexProbe } from './latex-probe';

/**
 * Rasterize a block formula to a canvas. KaTeX has no vector/SVG output, so the
 * only way math reaches a PDF or a 2D thumbnail is to render the HTML and snap
 * it to a bitmap — the same approach code blocks use for export
 * (page-frame-harvest.ts). Returns null for empty source or on capture failure.
 */
export async function rasterizeKatex(
  latex: string,
  pixelRatio: number,
): Promise<HTMLCanvasElement | null> {
  if (!latex.trim()) {
    return null;
  }

  const { node, cleanup } = mountLatexProbe(latex);
  try {
    // KaTeX glyphs are web fonts; without this the first export can capture
    // fallback metrics.
    await document.fonts?.ready?.catch(() => undefined);
    return await toCanvas(node, { pixelRatio, backgroundColor: undefined });
  } catch {
    return null;
  } finally {
    cleanup();
  }
}
