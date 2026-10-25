import { Channel, invoke } from '@tauri-apps/api/core';
import type { VFSNodeId } from '@/lib/sync';
import type { NativeRepository } from '@/lib/sync/repo/native';
import type { OneNoteImportResult } from '@/lib/sync/repo/native-operations';
import type { ImportProgress } from './dialog';

export const ONENOTE_DIALOG_FILTERS = [
  { name: 'OneNote', extensions: ['one', 'onepkg'] },
];

const ONENOTE_EXTENSION_RE = /\.(one|onepkg)$/i;

/**
 * Root folder name for the import: the picked file's basename without the
 * OneNote extension. Android hands back a `content://` URI whose document id is
 * percent-encoded, so decode before taking the last segment.
 */
export function oneNoteRootName(path: string): string {
  let decoded = path;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // not percent-encoded; keep as-is
    }
  }
  const base = decoded.split(/[/\\]/).pop() ?? decoded;
  return base.replace(ONENOTE_EXTENSION_RE, '') || 'OneNote';
}

export interface OneNotePreview {
  pages: number;
  sections: number;
}

export type { OneNoteImportResult } from '@/lib/sync/repo/native-operations';

export function scanOneNoteFile(path: string): Promise<OneNotePreview> {
  return invoke<OneNotePreview>('scan_onenote', { path });
}

export async function importOneNote({
  path,
  repository,
  parentId,
  rootName,
  fallbackTitle,
  onProgress,
}: {
  path: string;
  repository: NativeRepository;
  parentId: VFSNodeId | null;
  rootName: string;
  fallbackTitle: string;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<OneNoteImportResult> {
  const progress = new Channel<ImportProgress>();
  progress.onmessage = (value) => onProgress?.(value);
  return repository.importOneNote({
    path,
    parentId,
    rootName,
    fallbackTitle,
    progress,
  });
}
