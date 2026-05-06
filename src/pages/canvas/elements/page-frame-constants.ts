export const PAGE_WIDTH = 680;
export const PAGE_HEIGHT = 880;
export const PAGE_PADDING = 48;
export const PAGE_GAP = 40;
export const PAGE_CORNER_RADIUS = 3;

export function getDefaultPageFrameDisplayName(index: number): string {
  return `Page Frame ${index + 1}`;
}

export function normalizePageFrameDisplayName(
  index: number,
  displayName: unknown,
): string {
  const trimmed = typeof displayName === 'string' ? displayName.trim() : '';
  return trimmed || getDefaultPageFrameDisplayName(index);
}
