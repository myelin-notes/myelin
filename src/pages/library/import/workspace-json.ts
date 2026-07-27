import { Node as PMNode } from 'prosemirror-model';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import * as Y from 'yjs';
import { ElementType } from '@myelin/editor/elements/element-type';
import { parseNoteLinkTarget } from '@myelin/editor/note/link-target';
import { schema } from '@myelin/editor/page-frame/pm/schema';
import { YDocManager } from '@myelin/editor/ydoc-manager';
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

/** Resolves a note-link title to the imported note's new id, or null. */
export type NoteIdResolver = (title: string) => VFSNodeId | null;

/**
 * Rewrite the `noteId` on every note-link mark in a page-frame's ProseMirror
 * JSON to the id of the same-named note in *this* import.
 *
 * Exported note ids are meaningless in the destination workspace, so the ids
 * baked into note-link marks would otherwise dangle: the graph drops links
 * whose target id is unknown, and the editor treats a set id as authoritative
 * and never re-resolves it. We remap by title against the imported notes. An
 * unresolved link is cleared to null (target absent) so live title resolution
 * can reconnect it later; its stale `pageFrameId` is dropped for the same reason.
 */
function remapNoteLinkIds(
  content: unknown,
  resolveNoteId: NoteIdResolver,
): void {
  if (Array.isArray(content)) {
    for (const child of content) {
      remapNoteLinkIds(child, resolveNoteId);
    }
    return;
  }
  if (!content || typeof content !== 'object') {
    return;
  }

  const node = content as { marks?: unknown; content?: unknown };
  if (Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (!mark || typeof mark !== 'object') {
        continue;
      }
      const { type, attrs } = mark as {
        type?: unknown;
        attrs?: Record<string, unknown>;
      };
      if (type !== 'noteLink' || !attrs || typeof attrs.title !== 'string') {
        continue;
      }
      const noteId = resolveNoteId(attrs.title);
      attrs.noteId = noteId;
      if (noteId === null) {
        attrs.pageFrameId = null;
      }
    }
  }

  remapNoteLinkIds(node.content, resolveNoteId);
}

/**
 * Rebuild every element of a note into a freshly opened session's Y.Doc.
 *
 * `type`/`uuid` are the element identity; `content` is the reserved key holding
 * page-frame ProseMirror JSON (written to the XmlFragment, not the Y.Map). Every
 * other field is a Y.Map prop and is assumed to be a scalar or a base64-marked
 * binary — nested Yjs types are not reconstructed (none exist on elements today).
 *
 * `resolveNoteId`, when provided, remaps note-link ids to the imported notes so
 * links and the graph resolve within the destination workspace.
 */
export function rebuildNote(
  ydoc: YDocManager,
  note: NoteJson,
  resolveNoteId?: NoteIdResolver,
): void {
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
      if (resolveNoteId) {
        remapNoteLinkIds(content, resolveNoteId);
      }
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

interface PreparedNote {
  note: NoteJson;
  nodeId: VFSNodeId;
  /** Name links target this note by, before any uniqueness renaming. */
  baseName: string;
  /** '/'-separated source folder path, used to key path-qualified links. */
  folderPath: string;
}

async function createImportedNote({
  note,
  repository,
  parentId,
  folderPath,
  fallbackName,
}: {
  note: NoteJson;
  repository: Repository;
  parentId: VFSNodeId | null;
  folderPath: string;
  fallbackName: string;
}): Promise<PreparedNote> {
  const baseName = note.name?.trim() || fallbackName;
  // VFS timestamps can't be set on create, so the original createdAt/modifiedAt
  // survive only inside the JSON, not as the new node's dates.
  const name = await repository.getUniqueFileName(baseName, parentId);
  const nodeId = await repository.createFile(name, 'mcanvas', parentId);
  return { note, nodeId, baseName, folderPath };
}

/**
 * Build the note document in memory, then write it once.
 *
 * The target is a file this run just created, so there is no remote revision to
 * reconcile and no peer to sync with. Opening a session would read the empty
 * placeholder back twice (once to load the document, once to merge the push)
 * before writing the same bytes. This mirrors what `NoteSession.save` does to
 * the doc -- sweep orphans, then encode -- without the round trips.
 */
async function rebuildImportedNote(
  repository: Repository,
  prepared: PreparedNote,
  resolveNoteId: NoteIdResolver,
): Promise<void> {
  const ydoc = new YDocManager();
  rebuildNote(ydoc, prepared.note, resolveNoteId);
  ydoc.sweepOrphanPageFrameFragments();
  await repository.writeFileBytes(
    prepared.nodeId,
    Y.encodeStateAsUpdate(ydoc.doc),
  );

  if (prepared.note.tags?.length > 0) {
    await repository.setTags(prepared.nodeId, prepared.note.tags);
  }
}

/**
 * Resolve a note-link title to one of the just-imported notes. Mirrors the live
 * resolver ({@link parseNoteLinkTarget}): path-qualified titles match on the
 * source folder path, bare titles on note name (first import wins on collision).
 */
function createImportNoteLinkResolver(
  prepared: readonly PreparedNote[],
): NoteIdResolver {
  const byPath = new Map<string, VFSNodeId>();
  const byName = new Map<string, VFSNodeId>();
  for (const { nodeId, baseName, folderPath } of prepared) {
    const path = folderPath ? `${folderPath}/${baseName}` : baseName;
    if (!byPath.has(path)) {
      byPath.set(path, nodeId);
    }
    if (!byName.has(baseName)) {
      byName.set(baseName, nodeId);
    }
  }

  return (title) => {
    const parsed = parseNoteLinkTarget(title);
    if (!parsed) {
      return null;
    }
    const match = parsed.isPath
      ? byPath.get(parsed.path)
      : byName.get(parsed.noteName);
    return match ?? null;
  };
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
  let current = 0;
  let notesImported = 0;
  let mediaImported = 0;
  let failedFiles = 0;
  const total = scanned.notes.length + scanned.media.length;

  // Every folder and note this import creates lands on one manifest, saved once
  // when the batch closes, instead of a manifest write per node. Fatal setup
  // (creating the destination folders) aborts and rolls back; per-file failures
  // are isolated so one bad file can't discard the rest.
  try {
    await repository.batchManifestWrites(async () => {
      const root = await repository.createFolder(rootName, parentId);
      rootFolderId = root;
      const folderIds = await createImportedFolders(
        repository,
        root,
        scanned.folderPaths,
      );

      // Notes import in two passes: create every file first so note-link ids can
      // be remapped to the new nodes (links may point forward), then rebuild
      // content.
      const prepared: PreparedNote[] = [];
      for (const file of scanned.notes) {
        const fallbackName =
          file.absolutePath
            .replace(/\\/g, '/')
            .split('/')
            .pop()
            ?.replace(JSON_EXTENSION_RE, '') || 'Untitled';
        try {
          const note = parseNote(
            await readTextFile(file.absolutePath),
            file.absolutePath,
          );
          prepared.push(
            await createImportedNote({
              note,
              repository,
              parentId: getImportParentId(root, folderIds, file.folderPath),
              folderPath: file.folderPath,
              fallbackName,
            }),
          );
        } catch (error) {
          // Notes that fail to create never reach pass 2, so advance progress
          // here to keep the counter reaching `total` (pass 2 reports the rest).
          failedFiles += 1;
          onProgress?.({ current: ++current, total, fileName: fallbackName });
          logger.warn('Skipping note that failed to import', {
            path: file.absolutePath,
            error,
          });
        }
      }

      const resolveNoteId = createImportNoteLinkResolver(prepared);
      for (const preparedNote of prepared) {
        onProgress?.({
          current: ++current,
          total,
          fileName: preparedNote.baseName,
        });
        try {
          await rebuildImportedNote(repository, preparedNote, resolveNoteId);
          notesImported += 1;
        } catch (error) {
          failedFiles += 1;
          logger.warn('Skipping note that failed to rebuild', {
            nodeId: preparedNote.nodeId,
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
            getImportParentId(root, folderIds, file.folderPath),
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
    });
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

  if (rootFolderId === null) {
    throw new Error('Workspace import did not create a root folder.');
  }

  return {
    rootFolderId,
    notesImported,
    mediaImported,
    skippedFiles: scanned.skippedFiles + failedFiles,
  };
}
