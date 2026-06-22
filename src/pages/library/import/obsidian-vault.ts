import { join } from '@tauri-apps/api/path';
import { readDir, readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { Logger } from '@/lib/logger';
import {
  type FileType,
  getFileTypeForName,
  type Repository,
  type VFSNodeId,
} from '@/lib/sync';
import { addMarkdownPageFrameToYDoc } from '@/pages/canvas/page-frame/markdown/import';
import { getPdfPageSizes } from '@/pages/canvas/pdf-renderer';
import { addPdfElementToYDoc } from '@/pages/library/import/pdf';
import type { ImportProgress } from './dialog';
import {
  createImportedFolders,
  getImportParentId,
  getPathBasename,
} from './import-tree';

const logger = new Logger('ObsidianVaultImport');

const MARKDOWN_EXTENSION_RE = /\.(md|markdown|mdx)$/i;
const MARKDOWN_FRONT_MATTER_RE =
  /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m;
const PDF_EXTENSION_RE = /\.pdf$/i;

type VaultImportFile =
  | {
      kind: 'markdown';
      absolutePath: string;
      folderPath: string;
      name: string;
      noteName: string;
      notePath: string;
      nodeId: VFSNodeId | null;
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

export interface ScannedVault {
  files: VaultImportFile[];
  folderPaths: Set<string>;
  skippedFiles: number;
}

interface ParsedObsidianMarkdown {
  body: string;
  tags: string[];
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
  scanned?: ScannedVault;
  onProgress?: (progress: ImportProgress) => void;
}

export function getPathName(path: string): string {
  return getPathBasename(path, 'Obsidian Vault');
}

function joinRelativePath(segments: readonly string[]): string {
  return segments.join('/');
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

function isDotEntryName(name: string): boolean {
  return name.startsWith('.');
}

function normalizeFrontMatterTag(value: string): string | null {
  let tag = value.trim();
  const quote = tag[0];
  if ((quote === '"' || quote === "'") && tag.endsWith(quote)) {
    tag = tag.slice(1, -1);
  }

  tag = tag.trim();
  if (tag.startsWith('#')) {
    tag = tag.slice(1).trim();
  }

  if (!tag || tag === '[]' || tag === 'null' || tag === '~') {
    return null;
  }

  return tag;
}

function splitInlineYamlList(value: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ',') {
      items.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  items.push(current);
  return items;
}

function parseFrontMatterTagValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '[]') {
    return [];
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitInlineYamlList(trimmed.slice(1, -1))
      .map(normalizeFrontMatterTag)
      .filter((tag): tag is string => tag !== null);
  }

  const tag = normalizeFrontMatterTag(trimmed);
  return tag ? [tag] : [];
}

function extractFrontMatterTags(frontMatter: string): string[] {
  const lines = frontMatter.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const match = /^tags\s*:\s*(.*)$/.exec(lines[index]);
    if (!match) {
      continue;
    }

    const inlineValue = match[1] ?? '';
    if (inlineValue.trim()) {
      return Array.from(new Set(parseFrontMatterTagValue(inlineValue)));
    }

    const tags: string[] = [];
    for (let listIndex = index + 1; listIndex < lines.length; listIndex++) {
      const line = lines[listIndex];
      if (line.trim() === '') {
        continue;
      }
      if (/^\S/.test(line)) {
        break;
      }

      const itemMatch = /^\s*-\s*(.+?)\s*$/.exec(line);
      if (itemMatch) {
        tags.push(...parseFrontMatterTagValue(itemMatch[1] ?? ''));
      }
    }

    return Array.from(new Set(tags));
  }

  return [];
}

function parseObsidianMarkdown(markdown: string): ParsedObsidianMarkdown {
  const frontMatterMatch = MARKDOWN_FRONT_MATTER_RE.exec(markdown);
  if (!frontMatterMatch || frontMatterMatch.index !== 0) {
    return { body: markdown, tags: [] };
  }

  return {
    body: markdown.slice(frontMatterMatch[0].length),
    tags: extractFrontMatterTags(frontMatterMatch[1] ?? ''),
  };
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
    if (isDotEntryName(entry.name)) {
      continue;
    }

    if (entry.isSymlink) {
      scanned.skippedFiles += 1;
      continue;
    }

    const childPath = await join(absolutePath, entry.name);
    if (entry.isDirectory) {
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

export async function scanVault(vaultPath: string): Promise<ScannedVault> {
  const scanned: ScannedVault = {
    files: [],
    folderPaths: new Set(),
    skippedFiles: 0,
  };
  await scanVaultDirectory(vaultPath, [], scanned);
  return scanned;
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
): (target: string) => Promise<VFSNodeId | null> {
  const noteIdsByPath = new Map<string, VFSNodeId>();
  const noteIdsByName = new Map<string, VFSNodeId>();

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
  resolveNoteLinkId: (target: string) => Promise<VFSNodeId | null>;
}): Promise<void> {
  if (!file.nodeId) {
    throw new Error(`Markdown file was not created: ${file.name}`);
  }

  const markdown = await readTextFile(file.absolutePath);
  const parsedMarkdown = parseObsidianMarkdown(markdown);
  if (parsedMarkdown.tags.length > 0) {
    await repository.setTags(file.nodeId, parsedMarkdown.tags);
  }

  const session = await repository.openSession(file.nodeId);
  try {
    await addMarkdownPageFrameToYDoc(session.ydoc, parsedMarkdown.body, {
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
  parentId: string | null;
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
  parentId: string | null;
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
  scanned: preScanned,
  onProgress,
}: ImportObsidianVaultOptions): Promise<ObsidianVaultImportResult> {
  const scanned = preScanned ?? (await scanVault(vaultPath));
  if (scanned.files.length === 0) {
    throw new Error('No supported files found in the selected vault.');
  }

  let rootFolderId: string | null = null;
  let current = 0;
  const total = scanned.files.length;

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
      onProgress?.({ current: ++current, total, fileName: file.name });
      await writeMarkdownFile({ file, repository, resolveNoteLinkId });
    }

    let mediaImported = 0;
    for (const file of scanned.files) {
      if (file.kind === 'markdown') {
        continue;
      }

      onProgress?.({ current: ++current, total, fileName: file.name });
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
