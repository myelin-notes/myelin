export const PAGE_WIDTH = 680;
export const PAGE_HEIGHT = 880;
export const PAGE_PADDING = 48;
export const PAGE_GAP = 40;
export const PAGE_CORNER_RADIUS = 3;

/** Paper sizes in CSS px at 96 DPI, which PDF export maps to true points. */
export const PAGE_PRESETS = {
  letter: { width: 816, height: 1056 },
  a4: { width: 794, height: 1123 },
} as const;
export type PagePreset = keyof typeof PAGE_PRESETS;

// CSS px (96/in).
export const PAGE_PRESET_MARGIN = 96;
export const MAX_PAGE_MARGIN = 192;

export function normalizePagePreset(preset: unknown): PagePreset | null {
  return preset === 'letter' || preset === 'a4' ? preset : null;
}

export const DEFAULT_PAGE_FRAME_DISPLAY_NAME = 'Page Frame';

export type PageLayout = 'vertical' | 'horizontal' | 'continuous';
/** Page frames stack pages downward or run as one strip; only PDFs lay out in columns. */
export type PageFrameLayout = Exclude<PageLayout, 'horizontal'>;

// Frames saved with the removed `horizontal` layout open as pages.
export function normalizePageFrameLayout(layout: unknown): PageFrameLayout {
  return layout === 'continuous' ? 'continuous' : 'vertical';
}

export function normalizePageFrameDisplayName(displayName: unknown): string {
  const raw = typeof displayName === 'string' ? displayName : '';
  return raw.trim() || DEFAULT_PAGE_FRAME_DISPLAY_NAME;
}
