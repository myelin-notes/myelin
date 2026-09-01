import type { CSSProperties } from 'react';

// Matches `--bg-accent-amber`, which is the same in both themes.
export const DEFAULT_FOLDER_COLOR = '#fbbf24';

export const FOLDER_COLORS = [
  DEFAULT_FOLDER_COLOR,
  '#ef4444',
  '#f97316',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

export function folderIconStyle(color: string | undefined): CSSProperties {
  const resolved = color ?? DEFAULT_FOLDER_COLOR;
  return { color: resolved, fill: resolved };
}
