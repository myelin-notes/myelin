import { type Unzipped, unzip } from 'fflate';
import type { Repository, VFSNodeId } from '@/lib/sync';
import type { ImportProgress } from './dialog';
import {
  createImportedFolders,
  getImportParentId,
  getParentPath,
} from './import-tree';
import { importPdfFile } from './pdf';

export const GOODNOTES_ZIP_FILE_ACCEPT =
  'application/zip,application/x-zip-compressed,.zip';

const ZIP_EXTENSION_RE = /\.zip$/i;
const PDF_EXTENSION_RE = /\.pdf$/i;
const ZIP_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
]);

interface GoodnotesZipEntry {
  path: string;
  folderPath: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface GoodnotesZipImportResult {
  focusFolderId: VFSNodeId | null;
  pdfsImported: number;
  skippedFiles: number;
}

export interface ImportGoodnotesZipOptions {
  file: File;
  repository: Repository;
  parentId: VFSNodeId | null;
  fallbackTitle: string;
  onProgress?: (progress: ImportProgress) => void;
}

export function isZipFile(file: File): boolean {
  return ZIP_EXTENSION_RE.test(file.name) || ZIP_MIME_TYPES.has(file.type);
}

function normalizeZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  if (
    segments[0] === '__MACOSX' ||
    segments.some((segment) => segment.startsWith('.'))
  ) {
    return null;
  }

  return segments.join('/');
}

function addFolderAncestors(
  folderPaths: Set<string>,
  folderPath: string,
): void {
  if (!folderPath) {
    return;
  }

  const segments = folderPath.split('/');
  for (let i = 1; i <= segments.length; i++) {
    folderPaths.add(segments.slice(0, i).join('/'));
  }
}

async function readGoodnotesZipEntries(
  file: File,
): Promise<{ pdfEntries: GoodnotesZipEntry[]; skippedFiles: number }> {
  const archive = await unzipArchive(new Uint8Array(await file.arrayBuffer()));
  const pdfEntries: GoodnotesZipEntry[] = [];
  let skippedFiles = 0;

  for (const [rawPath, bytes] of Object.entries(archive)) {
    if (rawPath.endsWith('/')) {
      continue;
    }

    const path = normalizeZipPath(rawPath);
    if (!path) {
      continue;
    }

    if (!PDF_EXTENSION_RE.test(path)) {
      skippedFiles += 1;
      continue;
    }

    const fileName = path.split('/').pop();
    if (!fileName) {
      skippedFiles += 1;
      continue;
    }

    pdfEntries.push({
      path,
      folderPath: getParentPath(path),
      fileName,
      bytes,
    });
  }

  pdfEntries.sort((left, right) => left.path.localeCompare(right.path));
  return { pdfEntries, skippedFiles };
}

function unzipArchive(bytes: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, archive) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(archive);
    });
  });
}

function getFocusFolderId(
  parentId: VFSNodeId | null,
  folderIds: ReadonlyMap<string, VFSNodeId>,
): VFSNodeId | null {
  const topLevelFolderIds = [...folderIds.entries()]
    .filter(([folderPath]) => !folderPath.includes('/'))
    .map(([, folderId]) => folderId);
  return topLevelFolderIds.length === 1 ? topLevelFolderIds[0] : parentId;
}

function getCleanupNodeIds(
  folderIds: ReadonlyMap<string, VFSNodeId>,
  rootFileIds: readonly VFSNodeId[],
): VFSNodeId[] {
  const topLevelFolderIds = [...folderIds.entries()]
    .filter(([folderPath]) => !folderPath.includes('/'))
    .map(([, folderId]) => folderId);
  return [...topLevelFolderIds, ...rootFileIds];
}

export async function importGoodnotesZip(
  options: ImportGoodnotesZipOptions,
): Promise<GoodnotesZipImportResult> {
  return options.repository.batchManifestWrites(() =>
    importGoodnotesZipImpl(options),
  );
}

async function importGoodnotesZipImpl({
  file,
  repository,
  parentId,
  fallbackTitle,
  onProgress,
}: ImportGoodnotesZipOptions): Promise<GoodnotesZipImportResult> {
  const { pdfEntries, skippedFiles } = await readGoodnotesZipEntries(file);
  if (pdfEntries.length === 0) {
    throw new Error('No PDF files found in the selected ZIP.');
  }

  const rootFileIds: VFSNodeId[] = [];
  let folderIds = new Map<string, VFSNodeId>();

  try {
    const folderPaths = new Set<string>();
    for (const entry of pdfEntries) {
      addFolderAncestors(folderPaths, entry.folderPath);
    }

    folderIds = await createImportedFolders(repository, parentId, folderPaths);

    for (let index = 0; index < pdfEntries.length; index++) {
      const entry = pdfEntries[index];
      onProgress?.({
        current: index + 1,
        total: pdfEntries.length,
        fileName: entry.fileName,
      });
      const importedId = await importPdfFile({
        file: new File([entry.bytes], entry.fileName, {
          type: 'application/pdf',
        }),
        repository,
        parentId: getImportParentId(parentId, folderIds, entry.folderPath),
        fallbackTitle,
      });
      if (!entry.folderPath) {
        rootFileIds.push(importedId);
      }
    }

    return {
      focusFolderId: getFocusFolderId(parentId, folderIds),
      pdfsImported: pdfEntries.length,
      skippedFiles,
    };
  } catch (error) {
    for (const nodeId of getCleanupNodeIds(folderIds, rootFileIds)) {
      await repository.deleteNode(nodeId).catch(() => {});
    }
    throw error;
  }
}
