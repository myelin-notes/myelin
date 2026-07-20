import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as Y from 'yjs';
import { ElementType } from '@myelin/editor/elements/element-type';
import { schema } from '@myelin/editor/page-frame/pm/schema';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { invoke } from '@tauri-apps/api/core';
import { Logger } from '@/lib/logger';
import type { ReadableRepository, VFSFileNode } from '@/lib/sync';
import {
  BYTES_MARKER,
  base64EncodeBytes,
  NOTE_JSON_VERSION,
  type NoteJson,
} from './workspace-json-format';
import {
  type ExportPlan,
  type ExportProgress,
  type PlannedFile,
  planFolder,
  type VaultFileEntry,
} from './workspace-plan';

const logger = new Logger('WorkspaceJsonExport');

export interface ExportWorkspaceJsonResult {
  zipPath: string;
  notesExported: number;
  filesCopied: number;
}

export interface ExportWorkspaceJsonOptions {
  repository: ReadableRepository;
  /** Absolute zip path the user picked in the save dialog; also names the root folder. */
  outPath: string;
  onProgress?: (progress: ExportProgress) => void;
}

/**
 * Convert a value read out of an element's Y.Map into JSON-safe data. Binary
 * payloads (e.g. an image's bytes) become a {@link BYTES_MARKER} wrapper so the
 * importer can decode them back; everything else is passed through, recursing
 * into arrays and plain objects.
 */
function toJsonValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { [BYTES_MARKER]: base64EncodeBytes(value) };
  }
  if (value instanceof Y.AbstractType) {
    return value.toJSON();
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = toJsonValue(inner);
    }
    return out;
  }
  return value;
}

/** Serialize a single canvas element (its Y.Map fields plus page-frame text). */
function elementJson(
  ydoc: YDocManager,
  yMap: Y.Map<unknown>,
): Record<string, unknown> {
  const element: Record<string, unknown> = {};
  yMap.forEach((value, key) => {
    element[key] = toJsonValue(value);
  });

  // Page-frame text lives in a separate XmlFragment keyed by the element uuid,
  // not in the Y.Map, so pull it in as ProseMirror JSON.
  if (yMap.get('type') === ElementType.PAGE_FRAME) {
    const uuid = yMap.get('uuid');
    if (typeof uuid === 'string') {
      const doc = yXmlFragmentToProseMirrorRootNode(
        ydoc.getXmlFragment(uuid),
        schema,
      );
      element.content = doc.toJSON();
    }
  }

  return element;
}

/** Serialize every element of a note's Y.Doc to JSON-safe objects. */
export function serializeNoteElements(
  ydoc: YDocManager,
): Record<string, unknown>[] {
  const elements: Record<string, unknown>[] = [];
  for (let index = 0; index < ydoc.elements.length; index++) {
    elements.push(elementJson(ydoc, ydoc.elements.get(index)));
  }
  return elements;
}

/** Encode a canvas note as a JSON document carrying all of its elements. */
async function noteJson(
  repository: ReadableRepository,
  node: VFSFileNode,
): Promise<string> {
  const snapshot = await repository.loadDocument(node.id);
  const ydoc = snapshot.update
    ? YDocManager.fromUpdate(snapshot.update)
    : new YDocManager();

  const note: NoteJson = {
    version: NOTE_JSON_VERSION,
    name: node.name,
    fileType: node.fileType,
    tags: node.tags,
    createdAt: node.createdAt,
    modifiedAt: node.modifiedAt,
    elements: serializeNoteElements(ydoc),
  };
  return `${JSON.stringify(note, null, 2)}\n`;
}

/** Build the JSON body / source path a single file contributes, or null to skip. */
async function buildFileEntry(
  repository: ReadableRepository,
  file: PlannedFile,
): Promise<{ entry: VaultFileEntry; isNote: boolean } | null> {
  const relPath = [...file.segments, file.fileName].join('/');

  if (file.node.fileType === 'mcanvas') {
    return {
      entry: { relPath, text: await noteJson(repository, file.node) },
      isNote: true,
    };
  }

  // Standalone media is mirrored on disk, so the Rust side streams the stored
  // bytes from this path straight into the archive rather than through JSON.
  const sourcePath = await repository.getStoredAbsolutePath(file.node.id);
  if (!sourcePath) {
    logger.warn('Skipping file with no stored path', {
      nodeId: file.node.id,
      name: file.node.name,
    });
    return null;
  }
  return { entry: { relPath, copyFrom: sourcePath }, isNote: false };
}

export async function exportWorkspaceJson({
  repository,
  outPath,
  onProgress,
}: ExportWorkspaceJsonOptions): Promise<ExportWorkspaceJsonResult> {
  const plan: ExportPlan = { folders: [], files: [] };
  await planFolder(repository, null, [], plan, 'json');

  const entries: VaultFileEntry[] = [];
  let notesExported = 0;
  let filesCopied = 0;
  const total = plan.files.length;
  let current = 0;

  for (const file of plan.files) {
    onProgress?.({ current: ++current, total, name: file.node.name });
    const built = await buildFileEntry(repository, file);
    if (!built) {
      continue;
    }
    entries.push(built.entry);
    if (built.isNote) {
      notesExported += 1;
    } else {
      filesCopied += 1;
    }
  }

  // Shares the Obsidian export's plan shape, but Rust packs it into a single
  // zip: `text` files are written as entries and `copyFrom` media streamed in.
  const zipPath = await invoke<string>('export_workspace_zip', {
    request: {
      outPath,
      folders: plan.folders,
      files: entries,
    },
  });

  return { zipPath, notesExported, filesCopied };
}
