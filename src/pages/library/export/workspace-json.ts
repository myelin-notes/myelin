import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as Y from 'yjs';
import { invoke } from '@tauri-apps/api/core';
import { Logger } from '@/lib/logger';
import type { ReadableRepository, VFSFileNode } from '@/lib/sync';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { schema } from '@/pages/canvas/page-frame/pm/schema';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import {
  type ExportPlan,
  type ExportProgress,
  type PlannedFile,
  planFolder,
  sanitizeName,
  type VaultFileEntry,
} from './workspace-plan';

const logger = new Logger('WorkspaceJsonExport');

/** Schema version stamped on each exported note, for future import migration. */
export const NOTE_JSON_VERSION = 1;

const BASE64_CHUNK_SIZE = 0x8000;

export interface ExportWorkspaceJsonResult {
  vaultPath: string;
  notesExported: number;
  filesCopied: number;
}

export interface ExportWorkspaceJsonOptions {
  repository: ReadableRepository;
  /** Absolute directory the user picked; the export is created as a subfolder. */
  destDir: string;
  /** Name of the root folder created under {@link destDir}. */
  exportName: string;
  onProgress?: (progress: ExportProgress) => void;
}

function base64EncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Convert a value read out of an element's Y.Map into JSON-safe data. Binary
 * payloads (e.g. an image's bytes) become base64 strings; everything else is
 * passed through, recursing into arrays and plain objects.
 */
function toJsonValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return base64EncodeBytes(value);
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

/** Encode a canvas note as a JSON document carrying all of its elements. */
async function noteJson(
  repository: ReadableRepository,
  node: VFSFileNode,
): Promise<string> {
  const snapshot = await repository.loadDocument(node.id);
  const ydoc = snapshot.update
    ? YDocManager.fromUpdate(snapshot.update)
    : new YDocManager();

  const elements: Record<string, unknown>[] = [];
  for (let index = 0; index < ydoc.elements.length; index++) {
    elements.push(elementJson(ydoc, ydoc.elements.get(index)));
  }

  const note = {
    version: NOTE_JSON_VERSION,
    name: node.name,
    fileType: node.fileType,
    tags: node.tags,
    createdAt: node.createdAt,
    modifiedAt: node.modifiedAt,
    elements,
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

  // Standalone media is mirrored on disk, so the Rust side copies the stored
  // bytes directly from this path (matching the Obsidian vault export).
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
  destDir,
  exportName,
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

  // Reuses the Obsidian vault writer: it creates the folders, writes `text`
  // files and copies `copyFrom` media into the user-picked destination.
  const vaultPath = await invoke<string>('export_obsidian_vault', {
    request: {
      destDir,
      vaultName: sanitizeName(exportName) || 'Workspace',
      folders: plan.folders,
      files: entries,
    },
  });

  return { vaultPath, notesExported, filesCopied };
}
