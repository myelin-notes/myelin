export const PAGE_WIDTH = 680;
export const PAGE_HEIGHT = 880;
export const PAGE_PADDING = 48;
export const PAGE_GAP = 40;
export const PAGE_CORNER_RADIUS = 3;

export const DEFAULT_PAGE_FRAME_DISPLAY_NAME = 'Page Frame';

export type PageLayout = 'vertical' | 'horizontal';

export function normalizePageFrameDisplayName(displayName: unknown): string {
  const raw = typeof displayName === 'string' ? displayName : '';
  return raw.trim() || DEFAULT_PAGE_FRAME_DISPLAY_NAME;
}
