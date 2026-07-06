import { Node as PMNode } from 'prosemirror-model';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { ElementType } from '@myelin/editor/elements/element-type';
import { schema } from '@myelin/editor/page-frame/pm/schema';
import type { YDocManager } from '@myelin/editor/ydoc-manager';
import { join } from '@tauri-apps/api/path';
import { readDir, readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { Logger } from '@/lib/logger';
import {
  type FileType,
  getFileTypeForName,
  type Repository,
  type VFSNodeId,
} from '@/lib/sync';
import {
  BYTES_MARKER,
  base64DecodeBytes,
  isEncodedBytes,
  NOTE_JSON_VERSION,
  type NoteJson,
} from '@/pages/library/export/workspace-json-format';
import type { ImportProgress } from './dialog';
import {
  createImportedFolders,
  getImportParentId,
  getPathBasename,
} from './import-tree';

const logger = new Logger('WorkspaceJsonImport');

const JSON_EXTENSION_RE = /\.json$/i;

export interface ImportWorkspaceJsonResult {
  rootFolderId: VFSNodeId;
  notesImported: number;
  mediaImported: number;
  skippedFiles: number;
}

export interface ImportWorkspaceJsonOptions {
  repository: Repository;
  parentId: VFSNodeId | null;
  /** Absolute path to the exported workspace folder the user picked. */
  dirPath: string;
  /** Name for the created root folder; defaults to the picked folder's name. */
  rootName?: string;
  /** Pre-scanned result to avoid re-walking the directory. */
  scanned?: ScannedWorkspace;
  onProgress?: (progress: ImportProgress) => void;
}

interface ScannedNote {
  absolutePath: string;
  folderPath: string;
}

interface ScannedMedia {
  absolutePath: string;
  folderPath: string;
  name: string;
  fileType: FileType;
}

export interface ScannedWorkspace {
  /** Relative folder paths, including empty folders, '/'-separated. */
  folderPaths: Set<string>;
  notes: ScannedNote[];
  media: ScannedMedia[];
  skippedFiles: number;
}

export function getPathName(path: string): string {
  return getPathBasename(path, 'Workspace');
}

/** Convert a base64-marked binary back to bytes; otherwise recurse structurally. */
function decodeJsonValue(value: unknown): unknown {
  if (isEncodedBytes(value)) {
    return base64DecodeBytes(value[BYTES_MARKER]);
  }
  if (Array.isArray(value)) {
    return value.map(decodeJsonValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = decodeJsonValue(inner);
    }
    return out;
  }
  return value;
}

/**
 * Rebuild every element of a note into a freshly opened session's Y.Doc.
 *
 * `type`/`uuid` are the element identity; `content` is the reserved key holding
 * page-frame ProseMirror JSON (written to the XmlFragment, not the Y.Map). Every
 * other field is a Y.Map prop and is assumed to be a scalar or a base64-marked
 * binary — nested Yjs types are not reconstructed (none exist on elements today).
 */
export function rebuildNote(ydoc: YDocManager, note: NoteJson): void {
  for (const element of note.elements) {
    const { type, uuid, content, ...rest } = element as {
      type?: unknown;
      uuid?: unknown;
      content?: unknown;
    } & Record<string, unknown>;

    if (typeof type !== 'number' || typeof uuid !== 'string') {
      logger.warn('Skipping element with missing type/uuid', { type, uuid });
      continue;
    }

    const props = decodeJsonValue(rest) as Record<string, unknown>;
    ydoc.createElementMap(type, uuid, props);

    // Page-frame text lives in the XmlFragment keyed by uuid, mirroring export.
    if (type === ElementType.PAGE_FRAME && content) {
      const doc = PMNode.fromJSON(schema, content);
      const fragment = ydoc.getXmlFragment(uuid);
      ydoc.transact(() => {
        prosemirrorToYXmlFragment(doc, fragment);
      });
    }
  }
}

async function scanDirectory(
  absolutePath: string,
  relativeSegments: string[],
  scanned: ScannedWorkspace,
): Promise<void> {
  const entries = await readDir(absolutePath);

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymlink) {
      if (entry.isSymlink) {
        scanned.skippedFiles += 1;
      }
      continue;
    }

    const childPath = await join(absolutePath, entry.name);
    const childSegments = [...relativeSegments, entry.name];

    if (entry.isDirectory) {
      scanned.folderPaths.add(childSegments.join('/'));
      await scanDirectory(childPath, childSegments, scanned);
      continue;
    }

    if (!entry.isFile) {
      scanned.skippedFiles += 1;
      continue;
    }

    const folderPath = relativeSegments.join('/');
    if (JSON_EXTENSION_RE.test(entry.name)) {
      scanned.notes.push({ absolutePath: childPath, folderPath });
      continue;
    }

    const fileType = getFileTypeForName(entry.name);
    if (fileType && fileType !== 'mcanvas') {
      scanned.media.push({
        absolutePath: childPath,
        folderPath,
        name: entry.name,
        fileType,
      });
      continue;
    }

    scanned.skippedFiles += 1;
  }
}

function parseNote(raw: string, absolutePath: string): NoteJson {
  const note = JSON.parse(raw) as NoteJson;
  if (note.version !== NOTE_JSON_VERSION) {
    throw new Error(
      `Unsupported note version ${note.version} in ${absolutePath}`,
    );
  }
  if (!Array.isArray(note.elements)) {
    throw new Error(`Malformed note (no elements) in ${absolutePath}`);
  }
  return note;
}

async function importNote({
  note,
  repository,
  parentId,
  fallbackName,
}: {
  note: NoteJson;
  repository: Repository;
  parentId: VFSNodeId | null;
  fallbackName: string;
}): Promise<void> {
  const baseName = note.name?.trim() || fallbackName;
  // VFS timestamps can't be set on create, so the original createdAt/modifiedAt
  // survive only inside the JSON, not as the new node's dates.
  const name = await repository.getUniqueFileName(baseName, parentId);
  const nodeId = await repository.createFile(name, 'mcanvas', parentId);

  const session = await repository.openSession(nodeId);
  try {
    rebuildNote(session.ydoc, note);
    await session.save();
  } finally {
    await session.close().catch(() => {});
  }

  if (note.tags?.length > 0) {
    await repository.setTags(nodeId, note.tags);
  }
}

export async function scanWorkspaceJson(
  dirPath: string,
): Promise<ScannedWorkspace> {
  const scanned: ScannedWorkspace = {
    folderPaths: new Set(),
    notes: [],
    media: [],
    skippedFiles: 0,
  };
  await scanDirectory(dirPath, [], scanned);
  return scanned;
}

export async function importWorkspaceJson({
  repository,
  parentId,
  dirPath,
  rootName = getPathName(dirPath),
  scanned: preScanned,
  onProgress,
}: ImportWorkspaceJsonOptions): Promise<ImportWorkspaceJsonResult> {
  const scanned = preScanned ?? (await scanWorkspaceJson(dirPath));

  if (scanned.notes.length === 0 && scanned.media.length === 0) {
    throw new Error('No JSON notes or media found in the selected folder.');
  }

  let rootFolderId: VFSNodeId | null = null;
  let folderIds: Map<string, VFSNodeId>;
  let current = 0;
  let notesImported = 0;
  let mediaImported = 0;
  let failedFiles = 0;
  const total = scanned.notes.length + scanned.media.length;

  // Fatal setup (creating the destination folders) aborts and rolls back.
  // Per-file failures below are isolated so one bad file can't discard the rest.
  try {
    rootFolderId = await repository.createFolder(rootName, parentId);
    folderIds = await createImportedFolders(
      repository,
      rootFolderId,
      scanned.folderPaths,
    );
  } catch (error) {
    logger.error('Failed to import workspace JSON', error, {
      dirPath,
      rootFolderId,
    });
    if (rootFolderId) {
      await repository.deleteNode(rootFolderId).catch((deleteError) => {
        logger.error('Failed to clean up failed JSON import', deleteError, {
          rootFolderId,
        });
      });
    }
    throw error;
  }

  for (const file of scanned.notes) {
    const fallbackName =
      file.absolutePath
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        ?.replace(JSON_EXTENSION_RE, '') || 'Untitled';
    onProgress?.({ current: ++current, total, fileName: fallbackName });
    try {
      const note = parseNote(
        await readTextFile(file.absolutePath),
        file.absolutePath,
      );
      await importNote({
        note,
        repository,
        parentId: getImportParentId(rootFolderId, folderIds, file.folderPath),
        fallbackName,
      });
      notesImported += 1;
    } catch (error) {
      failedFiles += 1;
      logger.warn('Skipping note that failed to import', {
        path: file.absolutePath,
        error,
      });
    }
  }

  for (const file of scanned.media) {
    onProgress?.({ current: ++current, total, fileName: file.name });
    try {
      await repository.createFile(
        file.name,
        file.fileType,
        getImportParentId(rootFolderId, folderIds, file.folderPath),
        await readFile(file.absolutePath),
      );
      mediaImported += 1;
    } catch (error) {
      failedFiles += 1;
      logger.warn('Skipping media that failed to import', {
        path: file.absolutePath,
        error,
      });
    }
  }

  return {
    rootFolderId,
    notesImported,
    mediaImported,
    skippedFiles: scanned.skippedFiles + failedFiles,
  };
}
