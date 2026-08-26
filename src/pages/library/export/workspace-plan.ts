import type { ReadableRepository, VFSFileNode, VFSNodeId } from '@/lib/sync';

const ILLEGAL_NAME_CHARS = '/\\:*?"<>|';

export interface ExportProgress {
  current: number;
  total: number;
  name: string;
}

/** A note's serialized {@link text}, or a local source path to {@link copyFrom} for media on disk. */
export interface VaultFileEntry {
  relPath: string;
  text?: string;
  copyFrom?: string;
}

export interface PlannedFile {
  node: VFSFileNode;
  /** Output directory relative to the vault root. */
  segments: readonly string[];
  fileName: string;
}

export interface ExportPlan {
  folders: string[];
  files: PlannedFile[];
}

/** Replace filesystem-illegal characters and trim Windows-unsafe trailing dots. */
export function sanitizeName(name: string): string {
  return [...name]
    .map((char) =>
      char.charCodeAt(0) <= 0x1f || ILLEGAL_NAME_CHARS.includes(char)
        ? '-'
        : char,
    )
    .join('')
    .trim()
    .replace(/[. ]+$/, '');
}

/** Ensure a file/folder name is unique within its directory (case-insensitive). */
export function dedupeName(fileName: string, used: Set<string>): string {
  if (!used.has(fileName.toLowerCase())) {
    used.add(fileName.toLowerCase());
    return fileName;
  }
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let suffix = 2;
  let candidate = `${stem} (${suffix})${ext}`;
  while (used.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${stem} (${suffix})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

// Note files (canvas documents) are given {@link noteExtension}; other files keep their original
// name to be copied verbatim.
export async function planFolder(
  repository: ReadableRepository,
  folderId: VFSNodeId | null,
  parentSegments: readonly string[],
  plan: ExportPlan,
  noteExtension: string,
): Promise<void> {
  const [folders, files] = await repository.listDirectory(folderId);
  const used = new Set<string>();

  for (const folder of folders) {
    const name = dedupeName(sanitizeName(folder.name) || 'Folder', used);
    const segments = [...parentSegments, name];
    plan.folders.push(segments.join('/'));
    await planFolder(repository, folder.id, segments, plan, noteExtension);
  }

  for (const file of files) {
    const isNote = file.fileType === 'mcanvas';
    const base = sanitizeName(file.name) || (isNote ? 'Untitled' : 'file');
    const fileName = dedupeName(
      isNote ? `${base}.${noteExtension}` : base,
      used,
    );
    plan.files.push({ node: file, segments: parentSegments, fileName });
  }
}
