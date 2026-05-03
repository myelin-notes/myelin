import { join } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readDir, readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { Logger } from '@/lib/logger';
import { type FileType, getFileTypeForName, type Repository } from '@/lib/sync';
import { addMarkdownPageFrameToYDoc } from '@/pages/canvas/page-frame/markdown-import';
import { getPdfPageSizes } from '@/pages/canvas/pdf-renderer';
import { addPdfElementToYDoc } from '@/pages/library/import-pdf';

const logger = new Logger('ObsidianVaultImport');

const MARKDOWN_EXTENSION_RE = /\.(md|markdown|mdx)$/i;
const PDF_EXTENSION_RE = /\.pdf$/i;
const SKIPPED_DIRECTORY_NAMES = new Set(['.obsidian']);

type VaultImportFile =
  | {
      kind: 'markdown';
      absolutePath: string;
      folderPath: string;
      name: string;
      noteName: string;
      notePath: string;
      nodeId: string | null;
    }
  | {
      kind: 'pdf';
      absolutePath: string;
      folderPath: string;
      name: string;
    }
  | {
      kind: 'storage';
      absolutePath: string;
      fileType: FileType;
      folderPath: string;
      name: string;
    };

interface ScannedVault {
  files: VaultImportFile[];
  folderPaths: Set<string>;
  skippedFiles: number;
}

export interface ObsidianVaultImportResult {
  rootFolderId: string;
  notesImported: number;
  mediaImported: number;
  skippedFiles: number;
}

export interface ImportObsidianVaultOptions {
  repository: Repository;
  parentId: string | null;
  vaultPath: string;
  vaultName?: string;
}

function getPathName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').pop()?.trim() || 'Obsidian Vault';
}

function joinRelativePath(segments: readonly string[]): string {
  return segments.join('/');
}

function getParentPath(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function getMarkdownNoteName(fileName: string): string {
  const noteName = fileName.replace(MARKDOWN_EXTENSION_RE, '').trim();
  return noteName || fileName;
}

function getPdfCanvasName(fileName: string): string {
  const title = fileName.replace(PDF_EXTENSION_RE, '').trim();
  return title || fileName;
}

function isMarkdownFileName(fileName: string): boolean {
  return MARKDOWN_EXTENSION_RE.test(fileName);
}

function isPdfFileName(fileName: string): boolean {
  return PDF_EXTENSION_RE.test(fileName);
}

function addFolderAncestors(
  folderPaths: Set<string>,
  folderSegments: readonly string[],
): void {
  for (let i = 1; i <= folderSegments.length; i++) {
    folderPaths.add(joinRelativePath(folderSegments.slice(0, i)));
  }
}

function getImportFile(
  absolutePath: string,
  folderSegments: readonly string[],
  fileName: string,
): VaultImportFile | null {
  const folderPath = joinRelativePath(folderSegments);

  if (isMarkdownFileName(fileName)) {
    const noteName = getMarkdownNoteName(fileName);
    return {
      kind: 'markdown',
      absolutePath,
      folderPath,
      name: fileName,
      noteName,
      notePath: joinRelativePath([...folderSegments, noteName]),
      nodeId: null,
    };
  }

  if (isPdfFileName(fileName)) {
    return {
      kind: 'pdf',
      absolutePath,
      folderPath,
      name: fileName,
    };
  }

  const fileType = getFileTypeForName(fileName);
  if (fileType && fileType !== 'mcanvas') {
    return {
      kind: 'storage',
      absolutePath,
      fileType,
      folderPath,
      name: fileName,
    };
  }

  return null;
}

async function scanVaultDirectory(
  absolutePath: string,
  relativeSegments: string[],
  scanned: ScannedVault,
): Promise<void> {
  const entries = await readDir(absolutePath);

  for (const entry of entries) {
    if (entry.isSymlink) {
      scanned.skippedFiles += 1;
      continue;
    }

    const childPath = await join(absolutePath, entry.name);
    if (entry.isDirectory) {
      if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      await scanVaultDirectory(
        childPath,
        [...relativeSegments, entry.name],
        scanned,
      );
      continue;
    }

    if (!entry.isFile) {
      scanned.skippedFiles += 1;
      continue;
    }

    const importFile = getImportFile(childPath, relativeSegments, entry.name);
    if (!importFile) {
      scanned.skippedFiles += 1;
      continue;
    }

    scanned.files.push(importFile);
    addFolderAncestors(scanned.folderPaths, relativeSegments);
  }
}

async function scanVault(vaultPath: string): Promise<ScannedVault> {
  const scanned: ScannedVault = {
    files: [],
    folderPaths: new Set(),
    skippedFiles: 0,
  };
  await scanVaultDirectory(vaultPath, [], scanned);
  return scanned;
}

async function createImportedFolders(
  repository: Repository,
  rootFolderId: string,
  folderPaths: Set<string>,
): Promise<Map<string, string>> {
  const folderIds = new Map<string, string>();
  const sortedFolderPaths = [...folderPaths].sort(
    (left, right) => left.split('/').length - right.split('/').length,
  );

  for (const folderPath of sortedFolderPaths) {
    const parentPath = getParentPath(folderPath);
    const parentId = parentPath ? folderIds.get(parentPath) : rootFolderId;
    const name = folderPath.split('/').pop();
    if (!name || !parentId) {
      continue;
    }

    folderIds.set(folderPath, await repository.createFolder(name, parentId));
  }

  return folderIds;
}

function getImportParentId(
  rootFolderId: string,
  folderIds: ReadonlyMap<string, string>,
  folderPath: string,
): string {
  return folderPath
    ? (folderIds.get(folderPath) ?? rootFolderId)
    : rootFolderId;
}

function normalizeNoteLinkTarget(target: string): string | null {
  const withoutAlias = target.split('|', 1)[0]?.trim() ?? '';
  const withoutFragment = withoutAlias.split(/[#^]/, 1)[0]?.trim() ?? '';
  if (!withoutFragment) {
    return null;
  }

  const segments = withoutFragment
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim());
  if (segments.some((segment) => segment.length === 0)) {
    return null;
  }

  const noteName = segments.pop();
  if (!noteName) {
    return null;
  }

  return joinRelativePath([
    ...segments,
    noteName.replace(MARKDOWN_EXTENSION_RE, '').trim() || noteName,
  ]);
}

function createVaultNoteLinkResolver(
  markdownFiles: readonly Extract<VaultImportFile, { kind: 'markdown' }>[],
): (target: string) => Promise<string | null> {
  const noteIdsByPath = new Map<string, string>();
  const noteIdsByName = new Map<string, string>();

  for (const file of markdownFiles) {
    if (!file.nodeId) {
      continue;
    }
    noteIdsByPath.set(file.notePath, file.nodeId);
    if (!noteIdsByName.has(file.noteName)) {
      noteIdsByName.set(file.noteName, file.nodeId);
    }
  }

  return async (target: string) => {
    const normalizedTarget = normalizeNoteLinkTarget(target);
    if (!normalizedTarget) {
      return null;
    }

    if (normalizedTarget.includes('/')) {
      return noteIdsByPath.get(normalizedTarget) ?? null;
    }

    return noteIdsByName.get(normalizedTarget) ?? null;
  };
}

async function writeMarkdownFile({
  file,
  repository,
  resolveNoteLinkId,
}: {
  file: Extract<VaultImportFile, { kind: 'markdown' }>;
  repository: Repository;
  resolveNoteLinkId: (target: string) => Promise<string | null>;
}): Promise<void> {
  if (!file.nodeId) {
    throw new Error(`Markdown file was not created: ${file.name}`);
  }

  const markdown = await readTextFile(file.absolutePath);
  const session = await repository.openSession(file.nodeId);
  try {
    await addMarkdownPageFrameToYDoc(session.ydoc, markdown, {
      resolveNoteLinkId,
    });
    await session.save();
  } finally {
    await session.close().catch(() => {});
  }
}

async function importPdfVaultFile({
  file,
  repository,
  parentId,
}: {
  file: Extract<VaultImportFile, { kind: 'pdf' }>;
  repository: Repository;
  parentId: string;
}): Promise<void> {
  const bytes = await readFile(file.absolutePath);
  const pageSizes = await getPdfPageSizes(bytes);
  const nodeId = await repository.createFile(
    getPdfCanvasName(file.name),
    'mcanvas',
    parentId,
  );
  const session = await repository.openSession(nodeId);
  try {
    addPdfElementToYDoc(session.ydoc, bytes, file.name, pageSizes);
    await session.save();
  } finally {
    await session.close().catch(() => {});
  }
}

async function importStorageVaultFile({
  file,
  repository,
  parentId,
}: {
  file: Extract<VaultImportFile, { kind: 'storage' }>;
  repository: Repository;
  parentId: string;
}): Promise<void> {
  await repository.createFile(
    file.name,
    file.fileType,
    parentId,
    await readFile(file.absolutePath),
  );
}

export async function importObsidianVault({
  repository,
  parentId,
  vaultPath,
  vaultName = getPathName(vaultPath),
}: ImportObsidianVaultOptions): Promise<ObsidianVaultImportResult> {
  const scanned = await scanVault(vaultPath);
  if (scanned.files.length === 0) {
    throw new Error('No supported files found in the selected vault.');
  }

  let rootFolderId: string | null = null;

  try {
    rootFolderId = await repository.createFolder(vaultName, parentId);
    const folderIds = await createImportedFolders(
      repository,
      rootFolderId,
      scanned.folderPaths,
    );

    const markdownFiles = scanned.files.filter(
      (file): file is Extract<VaultImportFile, { kind: 'markdown' }> =>
        file.kind === 'markdown',
    );

    for (const file of markdownFiles) {
      file.nodeId = await repository.createFile(
        file.noteName,
        'mcanvas',
        getImportParentId(rootFolderId, folderIds, file.folderPath),
      );
    }

    const resolveNoteLinkId = createVaultNoteLinkResolver(markdownFiles);
    for (const file of markdownFiles) {
      await writeMarkdownFile({ file, repository, resolveNoteLinkId });
    }

    let mediaImported = 0;
    for (const file of scanned.files) {
      if (file.kind === 'markdown') {
        continue;
      }

      const importParentId = getImportParentId(
        rootFolderId,
        folderIds,
        file.folderPath,
      );
      if (file.kind === 'pdf') {
        await importPdfVaultFile({
          file,
          repository,
          parentId: importParentId,
        });
      } else {
        await importStorageVaultFile({
          file,
          repository,
          parentId: importParentId,
        });
      }
      mediaImported += 1;
    }

    return {
      rootFolderId,
      notesImported: markdownFiles.length,
      mediaImported,
      skippedFiles: scanned.skippedFiles,
    };
  } catch (error) {
    logger.error('Failed to import Obsidian vault', error, {
      vaultPath,
      rootFolderId,
    });
    if (rootFolderId) {
      await repository.deleteNode(rootFolderId).catch((deleteError) => {
        logger.error(
          'Failed to clean up failed Obsidian vault import',
          deleteError,
          {
            rootFolderId,
          },
        );
      });
    }
    throw error;
  }
}

export async function importObsidianVaultFromPicker({
  repository,
  parentId,
}: {
  repository: Repository;
  parentId: string | null;
}): Promise<ObsidianVaultImportResult | null> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    recursive: true,
  });
  if (!selected || Array.isArray(selected)) {
    return null;
  }

  return importObsidianVault({
    repository,
    parentId,
    vaultPath: selected,
  });
}
