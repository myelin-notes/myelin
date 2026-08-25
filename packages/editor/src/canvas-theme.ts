/**
 * Canvas 2D contexts can't reference CSS variables, so canvas *chrome* (grid, selection outlines,
 * drag previews, thumbnails) reads the theme tokens off the document root once and caches them.
 * Invalidated when `.dark` toggles on <html>; subscribers rebuild cached artifacts.
 *
 * User-drawn content (ink, highlighter, colored text) is document data and is NOT sourced from
 * here. The one exception is {@link resolveInkColor}.
 */
export interface CanvasPalette {
  /** Background grid / dot pattern. */
  grid: string;
  /** Selection + drag-preview outline. */
  selectionStroke: string;
  /** Selection + drag-preview fill tint. */
  selectionFill: string;
  /** Page-sheet / card surface painted into the canvas. */
  surface: string;
  /** Hairline border around canvas cards. */
  border: string;
  /** Strong accent navy (play buttons, played waveform). */
  accentDark: string;
  /** Muted track (unplayed waveform bars). */
  waveformTrack: string;
  /** Recording indicator red. */
  recording: string;
  /** Primary / muted text painted into canvas thumbnails. */
  textPrimary: string;
  textMuted: string;
  /** Muted shade fill (code blocks, placeholders in thumbnails). */
  muted: string;
}

let cached: CanvasPalette | null = null;
let observing = false;
const listeners = new Set<() => void>();

function readVar(
  styles: CSSStyleDeclaration,
  name: string,
  fallback: string,
): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

function compute(): CanvasPalette {
  const styles = getComputedStyle(document.documentElement);
  return {
    grid: readVar(styles, '--canvas-grid', 'rgba(164, 168, 172, 0.35)'),
    selectionStroke: readVar(styles, '--selection-stroke', '#2f3e46'),
    selectionFill: readVar(
      styles,
      '--selection-fill',
      'rgba(208, 225, 251, 0.15)',
    ),
    surface: readVar(styles, '--bg-card', '#ffffff'),
    border: readVar(styles, '--border-strong', 'rgba(195, 199, 202, 0.5)'),
    accentDark: readVar(styles, '--accent-dark', '#1c2738'),
    waveformTrack: readVar(styles, '--waveform-track', '#d0d5db'),
    recording: readVar(styles, '--bg-recording', '#e03e3e'),
    textPrimary: readVar(styles, '--text-primary', '#191c1e'),
    textMuted: readVar(styles, '--text-muted', '#5b6677'),
    muted: readVar(styles, '--muted', '#f2f4f6'),
  };
}

function ensureObserver(): void {
  if (observing || typeof MutationObserver === 'undefined') {
    return;
  }
  observing = true;
  const observer = new MutationObserver(() => {
    cached = null;
    for (const listener of listeners) {
      listener();
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

/** Theme-aware canvas chrome colors. Cached until the theme class changes. */
export function getCanvasPalette(): CanvasPalette {
  ensureObserver();
  if (!cached) {
    cached = compute();
  }
  return cached;
}

export function onCanvasThemeChange(listener: () => void): () => void {
  ensureObserver();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The "black" every tool palette leads with. Stored in the document verbatim, but it is the one
 * user color that names an *intent* ("default ink") rather than a literal shade, so painting
 * resolves it against the theme. The stored hex is `--text-primary`'s light-mode value.
 */
export const ADAPTIVE_INK = '#191c1e';

/**
 * Adaptive ink follows the theme so strokes drawn in light mode stay legible in dark mode; every
 * other color is the literal shade the user picked. Not used for PDF export — exported pages are
 * printed on white, so ink there keeps its stored (light) value.
 */
export function resolveInkColor(color: string): string {
  return color.toLowerCase() === ADAPTIVE_INK
    ? getCanvasPalette().textPrimary
    : color;
}

/** Apply an alpha to a `#rgb` / `#rrggbb` / `rgb(...)` color, returning `rgba(...)`. */
export function withCanvasAlpha(color: string, alpha: number): string {
  const text = color.trim();
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    const expand =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    const r = Number.parseInt(expand.slice(0, 2), 16);
    const g = Number.parseInt(expand.slice(2, 4), 16);
    const b = Number.parseInt(expand.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const match = text.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const [r, g, b] = match[1].split(',').map((p) => p.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return text;
}
