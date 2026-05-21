import { ImageFileTypes, VideoFileTypes } from '@/lib/sync/repo/types';

const IMAGE_EXT_RE = new RegExp(
  `\\.(${ImageFileTypes.join('|')})(\\?|#|$)`,
  'i',
);
const VIDEO_EXT_RE = new RegExp(
  `\\.(${VideoFileTypes.join('|')})(\\?|#|$)`,
  'i',
);

export type EmbedHint = 'image' | 'video' | null;
export type SyncEmbedKind = 'image' | 'video' | null;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function resolveSyncKind(url: string, hint: EmbedHint): SyncEmbedKind {
  if (hint === 'image') {
    return 'image';
  }
  if (hint === 'video') {
    return 'video';
  }
  const path = pathOf(url);
  if (IMAGE_EXT_RE.test(path)) {
    return 'image';
  }
  if (VIDEO_EXT_RE.test(path)) {
    return 'video';
  }
  return null;
}
