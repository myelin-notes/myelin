import * as Y from 'yjs';
import type {
  FileType,
  RepositoryStats,
  RepositoryTag,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
} from './types';

export interface VFSManifest {
  version: number;
  children: string[];
  nodes: Record<string, VFSNode>;
}

export interface RepositorySnapshot {
  manifest: VFSManifest;
  notes: Record<string, Uint8Array | null>;
}

export const CURRENT_MANIFEST_VERSION = 1;
export const MANIFEST_PATH = 'manifest.json';
export const FILES_DIR = 'files';
export const FILE_EXT = '.myelin';

export function createEmptyManifest(): VFSManifest {
  return {
    version: CURRENT_MANIFEST_VERSION,
    children: [],
    nodes: {},
  };
}

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
  id: string,
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

export function migrateManifest(manifest: VFSManifest): VFSManifest {
  const now = Date.now();
  for (const node of Object.values(manifest.nodes)) {
    if (node.createdAt == null) {
      node.createdAt = now;
    }
    if (node.modifiedAt == null) {
      node.modifiedAt = now;
    }
  }
  return manifest;
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
  const lowerQuery = query.toLowerCase();
  return Object.values(manifest.nodes).filter(
    (node) =>
      node.name.toLowerCase().includes(lowerQuery) ||
      node.tags.some((tag) => tag.toLowerCase().includes(lowerQuery)),
  );
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
): string[] {
  const node = manifest.nodes[nodeId];
  if (!node) {
    return [];
  }

  removeChild(manifest, node.parentId, nodeId);

  const fileIds: string[] = [];
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
      fileIds.push(currentId);
    }

    delete manifest.nodes[currentId];
  };

  collect(nodeId);
  return fileIds;
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

export function getNoteFileName(nodeId: string): string {
  return `${nodeId}${FILE_EXT}`;
}

export function getNotePath(nodeId: string): string {
  return `${FILES_DIR}/${getNoteFileName(nodeId)}`;
}
