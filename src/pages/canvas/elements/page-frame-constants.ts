export const PAGE_WIDTH = 680;
export const PAGE_HEIGHT = 880;
export const PAGE_PADDING = 48;
export const PAGE_GAP = 40;
export const PAGE_CORNER_RADIUS = 3;

export const DEFAULT_PAGE_FRAME_DISPLAY_NAME = 'Page Frame';

export function normalizePageFrameDisplayName(displayName: unknown): string {
  // Strip `#` and `|`: those are the frame separator and alias separator in
  // [[Note#Frame|Alias]] note-link syntax, and the parser has no escape form,
  // so a name containing them would round-trip incorrectly through links.
  const raw = typeof displayName === 'string' ? displayName : '';
  const trimmed = raw.replace(/[#|]/g, '').trim();
  return trimmed || DEFAULT_PAGE_FRAME_DISPLAY_NAME;
}
