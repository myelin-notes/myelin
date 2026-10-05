import * as Y from 'yjs';
import {
  createSearchIndex,
  type SearchField,
  type SearchIndex,
} from '@/lib/search';
import { addChild, dropNode, getChildIds, removeChild } from './child-index';
import { MAX_CUSTOM_COLORS, MAX_PEN_PRESETS } from './config';
import { expandTagWithAncestors, nodeMatchesAnyTag } from './tag-hierarchy';
import type {
  CustomColorTool,
  FileType,
  FileVersion,
  NodeSearchResult,
  NoteBacklink,
  PenPreset,
  PenPresetTool,
  RepositoryNoteGraph,
  RepositoryStats,
  RepositoryTag,
  StoredNoteLink,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
  VFSNodeId,
  VFSSystemMetadata,
} from './types';

export interface VFSManifest {
  version: number;
  nodes: Record<string, VFSNode>;
  linksBySource: Record<VFSNodeId, StoredNoteLink[]>;
  colors: Record<CustomColorTool, string[]>;
  tagRegistry: string[];
  penPresets: PenPreset[];
}

export interface RepositorySnapshot {
  manifest: VFSManifest;
  notes: Record<VFSNodeId, Uint8Array | null>;
}

export const CUSTOM_COLOR_TOOLS: readonly CustomColorTool[] = [
  'pen',
  'highlighter',
  'text',
  'folder',
];

// 2 dropped the `children` arrays: parentage is stored only as `node.parentId`,
// and the adjacency index is derived at runtime by `./child-index`.
export const CURRENT_MANIFEST_VERSION = 3;
export const MANIFEST_PATH = 'manifest.json';
export const FILES_DIR = 'files';
export const FILE_EXT = '.myelin';
export const VERSION_HISTORY_INTERVAL_MS = 10 * 60 * 1000;
export const VERSION_HISTORY_MAX_PER_FILE = 32;
export const VERSION_HISTORY_ROOT_NAME = '.myelin-version-history';
export function createEmptyManifest(): VFSManifest {
  return {
    version: CURRENT_MANIFEST_VERSION,
    nodes: {},
    linksBySource: {},
    colors: { pen: [], highlighter: [], text: [], folder: [] },
    tagRegistry: [],
    penPresets: [],
  };
}

export function migrate(manifest: VFSManifest): void {
  // Fields added after the initial schema are absent from manifests written by
  // older builds; default them so read paths don't spread `undefined`.
  manifest.tagRegistry ??= [];
  manifest.penPresets = sanitizePenPresets(manifest.penPresets);
  if (manifest.version < 2) {
    // Clear the v1 `children` arrays. Nothing reads them, but a parsed manifest round-trips unknown
    // keys back to disk on every save; `JSON.stringify` omits undefined-valued keys.
    (manifest as VFSManifest & { children?: undefined }).children = undefined;
    for (const node of Object.values(manifest.nodes)) {
      (node as VFSNode & { children?: undefined }).children = undefined;
    }
    manifest.version = 2;
  }

  const legacyManifest = manifest as VFSManifest & {
    customColors?: string[];
  };
  if (manifest.version < 3) {
    manifest.colors = {
      pen: (legacyManifest.customColors ?? []).slice(0, MAX_CUSTOM_COLORS),
      highlighter: [],
      text: [],
      folder: [],
    };
    legacyManifest.customColors = undefined;
    manifest.version = 3;
  }
  manifest.colors = {
    pen: manifest.colors?.pen ?? [],
    highlighter: manifest.colors?.highlighter ?? [],
    text: manifest.colors?.text ?? [],
    folder: manifest.colors?.folder ?? [],
  };
}

// Mirrors the pen and highlighter size options; a manifest can outlive the build that wrote it, so
// the bounds are restated here rather than imported from the tools.
const PEN_PRESET_SIZE_RANGE: Record<PenPresetTool, [number, number]> = {
  pen: [1, 40],
  highlighter: [12, 60],
};

/**
 * Presets arrive from another device and possibly another build, so entries are validated rather
 * than defaulted: anything unrecognised is dropped and out-of-range sizes are clamped.
 */
function sanitizePenPresets(presets: PenPreset[] | undefined): PenPreset[] {
  if (!Array.isArray(presets)) {
    return [];
  }
  const sane: PenPreset[] = [];
  for (const entry of presets) {
    const range = PEN_PRESET_SIZE_RANGE[entry?.tool];
    const color =
      typeof entry?.color === 'string'
        ? normalizeCustomColor(entry.color)
        : null;
    if (
      !range ||
      !color ||
      typeof entry.id !== 'string' ||
      !Number.isFinite(entry.size)
    ) {
      continue;
    }
    sane.push({
      id: entry.id,
      tool: entry.tool,
      color,
      size: Math.min(Math.max(entry.size, range[0]), range[1]),
      inWheel: entry.inWheel === true,
    });
    if (sane.length === MAX_PEN_PRESETS) {
      break;
    }
  }
  return sane;
}

export function createNodeId(): string {
  return crypto.randomUUID();
}

export function createFolderNode(
  id: string,
  name: string,
  parentId: string | null,
  now: number,
  system?: VFSSystemMetadata,
): VFSFolderNode {
  return {
    id,
    name,
    type: 'folder',
    parentId,
    tags: [],
    createdAt: now,
    modifiedAt: now,
    ...(system ? { system } : {}),
  };
}

export function createFileNode(
  id: VFSNodeId,
  name: string,
  fileType: FileType,
  parentId: string | null,
  now: number,
  system?: VFSSystemMetadata,
): VFSFileNode {
  return {
    id,
    name,
    type: 'file',
    fileType,
    parentId,
    tags: [],
    createdAt: now,
    modifiedAt: now,
    ...(system ? { system } : {}),
  };
}

export async function computeRevision(
  bytes: Uint8Array | null,
): Promise<string | null> {
  if (!bytes || bytes.byteLength === 0) {
    return null;
  }

  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function createDocFromBytes(bytes: Uint8Array | null): Y.Doc {
  const doc = new Y.Doc();
  if (bytes && bytes.byteLength > 0) {
    Y.applyUpdate(doc, bytes);
  }
  return doc;
}

export function getChildren(
  manifest: VFSManifest,
  folderId: string | null,
): VFSNode[] {
  return getChildrenIds(manifest, folderId)
    .map((id) => manifest.nodes[id])
    .filter(Boolean);
}

export function isSystemNode(node: VFSNode | null | undefined): boolean {
  return Boolean(node?.system);
}

export function isFileVersionNode(
  node: VFSNode | null | undefined,
): node is VFSFileNode & {
  system: Extract<VFSSystemMetadata, { kind: 'file-version' }>;
} {
  return node?.type === 'file' && node.system?.kind === 'file-version';
}

export function toFileVersion(
  node: VFSFileNode & {
    system: Extract<VFSSystemMetadata, { kind: 'file-version' }>;
  },
): FileVersion {
  return {
    id: node.id,
    sourceFileId: node.system.sourceFileId,
    sourceName: node.system.sourceName,
    fileType: node.system.sourceFileType,
    sourceRevision: node.system.sourceRevision,
    capturedAt: node.system.capturedAt,
    byteLength: node.system.byteLength,
  };
}

export function getFileVersionNodes(
  manifest: VFSManifest,
  sourceFileId: VFSNodeId,
): Array<
  VFSFileNode & {
    system: Extract<VFSSystemMetadata, { kind: 'file-version' }>;
  }
> {
  return Object.values(manifest.nodes)
    .filter(isFileVersionNode)
    .filter((node) => node.system.sourceFileId === sourceFileId)
    .sort((left, right) => right.system.capturedAt - left.system.capturedAt);
}

export function ensureVersionHistoryRoot(
  manifest: VFSManifest,
  now: number,
): VFSNodeId {
  const existing = Object.values(manifest.nodes).find(
    (node) =>
      node.type === 'folder' && node.system?.kind === 'version-history-root',
  );
  if (existing?.type === 'folder') {
    return existing.id;
  }

  const rootId = createNodeId();
  manifest.nodes[rootId] = createFolderNode(
    rootId,
    VERSION_HISTORY_ROOT_NAME,
    null,
    now,
    { kind: 'version-history-root' },
  );
  addChild(manifest, null, rootId);
  return rootId;
}

export { addChild, removeChild } from './child-index';

export function getChildrenIds(
  manifest: VFSManifest,
  folderId: string | null,
): readonly string[] {
  if (folderId !== null && manifest.nodes[folderId]?.type !== 'folder') {
    return [];
  }
  return getChildIds(manifest, folderId);
}

export function listDirectoryNodes(
  manifest: VFSManifest,
  folderId: string | null,
): [VFSFolderNode[], VFSFileNode[]] {
  const children = getChildren(manifest, folderId).filter(
    (node) => !isSystemNode(node),
  );
  const folders: VFSFolderNode[] = [];
  const files: VFSFileNode[] = [];

  for (const node of children) {
    if (node.type === 'folder') {
      folders.push(node);
    } else {
      files.push(node);
    }
  }

  return [folders, files];
}

export function getFolderChain(
  manifest: VFSManifest,
  folderId: string | null,
): VFSFolderNode[] {
  if (folderId === null) {
    return [];
  }

  const chain: VFSFolderNode[] = [];
  let current: VFSNode | undefined = manifest.nodes[folderId];
  while (current && current.type === 'folder') {
    chain.unshift(current);
    if (current.parentId === null) {
      break;
    }
    current = manifest.nodes[current.parentId];
  }

  return chain;
}

function nodeSearchFields(): SearchField<VFSNode>[] {
  return [
    { name: 'name', weight: 4, getValue: (node) => node.name },
    { name: 'tags', weight: 3, getValue: (node) => node.tags },
    { name: 'kind', getValue: (node) => node.type },
    {
      name: 'fileType',
      getValue: (node) => (node.type === 'file' ? node.fileType : ''),
    },
  ];
}

// Callers that search repeatedly (search-as-you-type) should build this once rather than
// re-tokenizing every node's name, tags and indexed content on each query.
export function createNodeSearchIndex(
  manifest: VFSManifest,
): SearchIndex<VFSNode> {
  return createSearchIndex({
    items: Object.values(manifest.nodes).filter((node) => !isSystemNode(node)),
    getId: (node) => node.id,
    fields: nodeSearchFields(),
  });
}

export function searchNodeResults(
  manifest: VFSManifest,
  query: string,
  index?: SearchIndex<VFSNode>,
): NodeSearchResult[] {
  const searchIndex = index ?? createNodeSearchIndex(manifest);
  return searchIndex.search(query).map((hit) => ({
    node: hit.item,
    score: hit.score,
    contentSnippet: null,
    matchedTerms: hit.terms,
  }));
}

export function getNodesByExactName(
  manifest: VFSManifest,
  name: string,
): VFSNode[] {
  return Object.values(manifest.nodes).filter(
    (node) => !isSystemNode(node) && node.name === name,
  );
}

export function getNodesByAnyTag(
  manifest: VFSManifest,
  tags: string[],
  folderId: string | null = null,
): VFSNode[] {
  return Object.values(manifest.nodes).filter(
    (node) =>
      !isSystemNode(node) &&
      nodeMatchesAnyTag(node.tags, tags) &&
      isNodeWithinFolder(manifest, node, folderId),
  );
}

// A null `folderId` means the repository root, so every node qualifies.
function isNodeWithinFolder(
  manifest: VFSManifest,
  node: VFSNode,
  folderId: string | null,
): boolean {
  if (folderId === null) {
    return true;
  }
  let current: VFSNode | undefined = node;
  while (current) {
    if (current.parentId === folderId) {
      return true;
    }
    if (current.parentId === null) {
      return false;
    }
    current = manifest.nodes[current.parentId];
  }
  return false;
}

export function listTags(manifest: VFSManifest): RepositoryTag[] {
  const counts = new Map<string, number>();

  for (const node of Object.values(manifest.nodes)) {
    if (isSystemNode(node)) {
      continue;
    }
    for (const tag of node.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function listHierarchicalTags(manifest: VFSManifest): RepositoryTag[] {
  const counts = new Map<string, number>();

  for (const node of Object.values(manifest.nodes)) {
    if (isSystemNode(node)) {
      continue;
    }
    const prefixes = new Set<string>();
    for (const tag of node.tags) {
      for (const prefix of expandTagWithAncestors(tag)) {
        prefixes.add(prefix);
      }
    }
    for (const prefix of prefixes) {
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function getStats(manifest: VFSManifest): RepositoryStats {
  let totalFiles = 0;
  let totalFolders = 0;
  const tagSet = new Set<string>();

  for (const node of Object.values(manifest.nodes)) {
    if (isSystemNode(node)) {
      continue;
    }
    if (node.type === 'file') {
      totalFiles++;
    } else {
      totalFolders++;
    }

    for (const tag of node.tags) {
      tagSet.add(tag);
    }
  }

  return {
    totalFiles,
    totalFolders,
    totalTags: tagSet.size,
  };
}

export function getRecentFiles(
  manifest: VFSManifest,
  limit: number = 3,
): VFSFileNode[] {
  return Object.values(manifest.nodes)
    .filter(
      (node): node is VFSFileNode =>
        node.type === 'file' && !isSystemNode(node),
    )
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, limit);
}

export function getBacklinks(
  manifest: VFSManifest,
  noteId: VFSNodeId,
): NoteBacklink[] {
  const backlinks: NoteBacklink[] = [];

  for (const [sourceId, links] of Object.entries(manifest.linksBySource)) {
    const source = manifest.nodes[sourceId] as VFSFileNode | undefined;
    if (!source || isSystemNode(source)) {
      continue;
    }

    for (const link of links) {
      if (link.targetId === noteId) {
        backlinks.push({
          ...link,
          sourceId: source.id,
          sourceName: source.name,
        });
      }
    }
  }

  return backlinks;
}

function isGraphCanvasNode(
  node: VFSNode | null | undefined,
): node is VFSFileNode {
  return (
    node?.type === 'file' && node.fileType === 'mcanvas' && !isSystemNode(node)
  );
}

export function getNoteGraph(manifest: VFSManifest): RepositoryNoteGraph {
  const nodes = Object.values(manifest.nodes)
    .filter(isGraphCanvasNode)
    .map((node) => ({
      id: node.id,
      name: node.name,
      tags: node.tags,
    }));

  const canvasNodeIds = new Set(nodes.map((node) => node.id));
  const links = Object.entries(manifest.linksBySource).flatMap(
    ([sourceId, sourceLinks]) => {
      if (!canvasNodeIds.has(sourceId)) {
        return [];
      }

      return sourceLinks.map((link) => ({
        ...link,
        sourceId,
      }));
    },
  );

  return { nodes, links };
}

export function setStoredNoteLinks(
  manifest: VFSManifest,
  sourceId: VFSNodeId,
  links: readonly StoredNoteLink[],
): void {
  if (links.length === 0) {
    delete manifest.linksBySource[sourceId];
    return;
  }

  manifest.linksBySource[sourceId] = links.map((link) => ({ ...link }));
}

export function getUniqueFileName(
  manifest: VFSManifest,
  baseName: string,
  parentId: string | null,
): string {
  const children = getChildren(manifest, parentId).filter(
    (node) => !isSystemNode(node),
  );
  const names = new Set(children.map((node) => node.name));

  if (!names.has(baseName)) {
    return baseName;
  }

  let counter = 1;
  while (names.has(`${baseName} ${counter}`)) {
    counter++;
  }

  return `${baseName} ${counter}`;
}

export function deleteNodeFromManifest(
  manifest: VFSManifest,
  nodeId: string,
): VFSFileNode[] {
  const node = manifest.nodes[nodeId];
  if (!node) {
    return [];
  }

  removeChild(manifest, node.parentId, nodeId);

  const files: VFSFileNode[] = [];
  const collect = (currentId: string) => {
    const current = manifest.nodes[currentId];
    if (!current) {
      return;
    }

    if (current.type === 'folder') {
      for (const childId of getChildIds(manifest, currentId)) {
        collect(childId);
      }
    } else {
      // The node is removed from the manifest below and never mutated after,
      // so callers can safely take the live reference without a defensive copy.
      files.push(current);
      // Version-history snapshots live under the hidden root, not under the
      // file itself, so deleting the file would orphan them. Drop them too.
      if (!isFileVersionNode(current)) {
        for (const version of getFileVersionNodes(manifest, currentId)) {
          removeChild(manifest, version.parentId, version.id);
          collect(version.id);
        }
      }
    }

    delete manifest.linksBySource[currentId];
    delete manifest.nodes[currentId];
    dropNode(manifest, currentId);
  };

  collect(nodeId);
  return files;
}

export function moveNodeInManifest(
  manifest: VFSManifest,
  nodeId: string,
  newParentId: string | null,
): void {
  const node = manifest.nodes[nodeId];
  if (!node || node.parentId === newParentId) {
    return;
  }

  if (newParentId !== null) {
    const newParent = manifest.nodes[newParentId];
    if (!newParent || newParent.type !== 'folder') {
      return;
    }

    if (node.type === 'folder') {
      let checkId: string | null = newParentId;
      while (checkId !== null) {
        if (checkId === nodeId) {
          return;
        }
        const current: VFSNode | undefined = manifest.nodes[checkId];
        checkId = current?.parentId ?? null;
      }
    }
  }

  removeChild(manifest, node.parentId, nodeId);
  node.parentId = newParentId;
  node.modifiedAt = Date.now();
  addChild(manifest, newParentId, nodeId);
}

export function normalizeCustomColor(color: string): string | null {
  const trimmed = color.trim();
  const match = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  return `#${match[1].toLowerCase()}`;
}

export function getStoredFileName(
  node: Pick<VFSFileNode, 'id' | 'fileType'>,
): string {
  if (node.fileType === 'mcanvas') {
    return getNoteFileName(node.id);
  }
  return `${node.id}.${node.fileType}`;
}

export function getStoredFilePath(
  node: Pick<VFSFileNode, 'id' | 'fileType'>,
): string {
  return `${FILES_DIR}/${getStoredFileName(node)}`;
}

export function getNoteFileName(nodeId: VFSNodeId): string {
  return `${nodeId}${FILE_EXT}`;
}

export function getNotePath(nodeId: VFSNodeId): string {
  return `${FILES_DIR}/${getNoteFileName(nodeId)}`;
}
