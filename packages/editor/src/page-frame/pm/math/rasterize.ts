import { toCanvas } from 'html-to-image';
import { withTimeout } from '../../../utils/with-timeout';
import { mountLatexProbe } from './latex-probe';

// html-to-image never settles if `img.decode()` rejects, which would strand the probe in the DOM.
const CAPTURE_TIMEOUT_MS = 5_000;

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
  const capture = async () => {
    // KaTeX glyphs are web fonts; without this the first export can capture
    // fallback metrics.
    await document.fonts?.ready?.catch(() => undefined);
    return toCanvas(node, { pixelRatio, backgroundColor: undefined });
  };
  try {
    return await withTimeout(capture(), CAPTURE_TIMEOUT_MS);
  } catch {
    return null;
  } finally {
    cleanup();
  }
}
