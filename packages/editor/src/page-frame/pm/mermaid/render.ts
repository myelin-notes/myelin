import type { Mermaid } from 'mermaid';
import { onCanvasThemeChange } from '../../../canvas-theme';

let mermaidPromise: Promise<Mermaid> | null = null;
let configuredDark: boolean | null = null;
let renderId = 0;

const themeListeners = new Set<() => void>();
let themeSubscribed = false;
let observedDark = false;

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark');
}

function loadMermaid(): Promise<Mermaid> {
  // Dynamic import keeps mermaid (~MBs) out of the main chunk. Don't cache a rejection: clear the
  // slot so a later render retries instead of re-awaiting the same failure.
  mermaidPromise ??= import('mermaid')
    .then(({ default: mermaid }) => mermaid)
    .catch((error) => {
      mermaidPromise = null;
      throw error;
    });
  return mermaidPromise;
}

// Mermaid bakes colors into the SVG at render time, so theme flips need a re-render (see
// onMermaidThemeChange). Throws on invalid source; callers keep their last good diagram.
export async function renderMermaidSvg(source: string): Promise<string> {
  const mermaid = await loadMermaid();
  const dark = isDarkTheme();
  if (dark !== configuredDark) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'neutral',
      fontFamily: 'var(--font-sans)',
    });
    configuredDark = dark;
  }

  const id = `pm-mermaid-${renderId++}`;
  try {
    const { svg } = await mermaid.render(id, source);
    return svg;
  } catch (error) {
    // A failed parse can leave mermaid's scratch element in the body.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
    throw error;
  }
}

/**
 * Piggybacks on the canvas theme observer rather than owning a MutationObserver. That observer
 * fires on any <html> class mutation, so a shared handler filters down to actual dark/light flips
 * before notifying — the flip check runs once, not per subscriber.
 */
export function onMermaidThemeChange(listener: () => void): () => void {
  if (!themeSubscribed) {
    themeSubscribed = true;
    observedDark = isDarkTheme();
    onCanvasThemeChange(() => {
      const dark = isDarkTheme();
      if (dark === observedDark) {
        return;
      }
      observedDark = dark;
      for (const notify of themeListeners) {
        notify();
      }
    });
  }

  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}
