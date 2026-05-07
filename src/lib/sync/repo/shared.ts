import * as Y from 'yjs';
import { searchItems } from '@/lib/search';
import {
  type FileType,
  FileTypes,
  ImageFileTypes,
  type NoteBacklink,
  type RepositoryStats,
  type RepositoryTag,
  type StoredNoteLink,
  type VFSFileNode,
  type VFSFolderNode,
  type VFSNode,
  type VFSNodeId,
  VideoFileTypes,
} from './types';

export interface VFSManifest {
  version: number;
  children: string[];
  nodes: Record<string, VFSNode>;
  linksBySource: Record<VFSNodeId, StoredNoteLink[]>;
  customColors: string[];
}

export interface RepositorySnapshot {
  manifest: VFSManifest;
  notes: Record<VFSNodeId, Uint8Array | null>;
}

export const CURRENT_MANIFEST_VERSION = 1;
export const MANIFEST_PATH = 'manifest.json';
export const FILES_DIR = 'files';
export const FILE_EXT = '.myelin';
const FILE_TYPE_SET = new Set<string>(FileTypes);
const IMAGE_FILE_TYPE_SET = new Set<string>(ImageFileTypes);
const VIDEO_FILE_TYPE_SET = new Set<string>(VideoFileTypes);

const MIME_TYPE_BY_FILE_TYPE: Record<FileType, string> = {
  mcanvas: 'application/octet-stream',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
};

export function createEmptyManifest(): VFSManifest {
  return {
    version: CURRENT_MANIFEST_VERSION,
    children: [],
    nodes: {},
    linksBySource: {},
    customColors: [],
  };
}

export function migrate(_manifest: VFSManifest): void {}

export function createNodeId(): string {
  return crypto.randomUUID();
}

export function createFolderNode(
  id: string,
  name: string,
  parentId: string | null,
  now: number,
): VFSFolderNode {
  return {
    id,
    name,
    type: 'folder',
    parentId,
    children: [],
    tags: [],
    createdAt: now,
    modifiedAt: now,
  };
}

export function createFileNode(
  id: VFSNodeId,
  name: string,
  fileType: FileType,
  parentId: string | null,
  now: number,
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

export function getChildrenIds(
  manifest: VFSManifest,
  folderId: string | null,
): string[] {
  if (folderId === null) {
    return manifest.children;
  }

  const folder = manifest.nodes[folderId];
  if (!folder || folder.type !== 'folder') {
    return [];
  }

  return folder.children;
}

export function addChild(
  manifest: VFSManifest,
  parentId: string | null,
  childId: string,
): void {
  if (parentId === null) {
    manifest.children.push(childId);
    return;
  }

  const parent = manifest.nodes[parentId];
  if (parent && parent.type === 'folder') {
    parent.children.push(childId);
  }
}

export function removeChild(
  manifest: VFSManifest,
  parentId: string | null,
  childId: string,
): void {
  if (parentId === null) {
    manifest.children = manifest.children.filter((id) => id !== childId);
    return;
  }

  const parent = manifest.nodes[parentId];
  if (parent && parent.type === 'folder') {
    parent.children = parent.children.filter((id) => id !== childId);
  }
}

export function listDirectoryNodes(
  manifest: VFSManifest,
  folderId: string | null,
): [VFSFolderNode[], VFSFileNode[]] {
  const children = getChildren(manifest, folderId);
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

export function searchNodes(manifest: VFSManifest, query: string): VFSNode[] {
  return searchItems(Object.values(manifest.nodes), query, {
    getId: (node) => node.id,
    fields: [
      { name: 'name', weight: 4, getValue: (node) => node.name },
      { name: 'tags', weight: 3, getValue: (node) => node.tags },
      { name: 'kind', getValue: (node) => node.type },
      {
        name: 'fileType',
        getValue: (node) => (node.type === 'file' ? node.fileType : ''),
      },
    ],
  }).map((hit) => hit.item);
}

export function getNodesByAnyTag(
  manifest: VFSManifest,
  tags: string[],
): VFSNode[] {
  const tagSet = new Set(tags);
  return Object.values(manifest.nodes).filter((node) =>
    node.tags.some((tag) => tagSet.has(tag)),
  );
}

export function listTags(manifest: VFSManifest): RepositoryTag[] {
  const counts = new Map<string, number>();

  for (const node of Object.values(manifest.nodes)) {
    for (const tag of node.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
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
    .filter((node): node is VFSFileNode => node.type === 'file')
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
    if (!source) {
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
  const children = getChildren(manifest, parentId);
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
      for (const childId of current.children) {
        collect(childId);
      }
    } else {
      files.push(structuredClone(current));
    }

    delete manifest.linksBySource[currentId];
    delete manifest.nodes[currentId];
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

export function isSupportedFileType(value: string): value is FileType {
  return FILE_TYPE_SET.has(value);
}

export function isImageFileType(fileType: FileType): boolean {
  return IMAGE_FILE_TYPE_SET.has(fileType);
}

export function isVideoFileType(fileType: FileType): boolean {
  return VIDEO_FILE_TYPE_SET.has(fileType);
}

export function getFileTypeForName(name: string): FileType | null {
  const extension = name.split('.').pop()?.toLowerCase();
  if (!extension || !isSupportedFileType(extension)) {
    return null;
  }
  return extension;
}

export function getMimeTypeForFileType(fileType: FileType): string {
  return MIME_TYPE_BY_FILE_TYPE[fileType];
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
