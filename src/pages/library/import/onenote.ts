import { Channel, invoke } from '@tauri-apps/api/core';
import type { Repository, VFSNodeId } from '@/lib/sync';
import { NativeRepository } from '@/lib/sync/repo/native';
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

export interface OneNoteImportResult {
  rootFolderId: VFSNodeId;
  pagesImported: number;
  skippedPages: number;
}

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
  repository: Repository;
  parentId: VFSNodeId | null;
  rootName: string;
  fallbackTitle: string;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<OneNoteImportResult> {
  if (!(repository instanceof NativeRepository)) {
    throw new Error('OneNote import requires a native repository');
  }
  await repository.initialize();
  const progress = new Channel<ImportProgress>();
  progress.onmessage = (value) => onProgress?.(value);
  return invoke<OneNoteImportResult>('repository_operation', {
    handle: repository.nativeRepositoryHandle,
    operation: {
      kind: 'import-one-note',
      path,
      parentId,
      rootName,
      fallbackTitle,
      progress,
    },
  });
}
