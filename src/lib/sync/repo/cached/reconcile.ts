import type { RepositorySnapshot, VFSManifest } from '../shared';
import type { VFSNode } from '../types';

export function isSnapshotEmpty(snapshot: RepositorySnapshot): boolean {
  return (
    snapshot.manifest.children.length === 0 &&
    Object.keys(snapshot.manifest.nodes).length === 0 &&
    Object.keys(snapshot.manifest.linksBySource ?? {}).length === 0 &&
    snapshot.manifest.customColors.length === 0
  );
}

export function detachNodeFromAllContainers(
  manifest: VFSManifest,
  nodeId: string,
): void {
  manifest.children = manifest.children.filter((id) => id !== nodeId);
  for (const current of Object.values(manifest.nodes)) {
    if (current.type === 'folder') {
      current.children = current.children.filter((id) => id !== nodeId);
    }
  }
}

function detachNodeFromOtherContainers(
  manifest: VFSManifest,
  nodeId: string,
  targetParentId: string | null,
): void {
  if (targetParentId !== null) {
    manifest.children = manifest.children.filter((id) => id !== nodeId);
  }

  for (const current of Object.values(manifest.nodes)) {
    if (current.type === 'folder' && current.id !== targetParentId) {
      current.children = current.children.filter((id) => id !== nodeId);
    }
  }
}

function addChildIfMissing(
  manifest: VFSManifest,
  parentId: string | null,
  childId: string,
): void {
  const children =
    parentId === null
      ? manifest.children
      : manifest.nodes[parentId]?.type === 'folder'
        ? manifest.nodes[parentId].children
        : null;

  if (children && !children.includes(childId)) {
    children.push(childId);
  }
}

function upsertNodePreservingRemoteChildren(
  remoteManifest: VFSManifest,
  cacheNode: VFSNode,
): void {
  const nextNode = structuredClone(cacheNode);
  const remoteNode = remoteManifest.nodes[cacheNode.id];
  if (nextNode.type === 'folder') {
    nextNode.children =
      remoteNode?.type === 'folder' ? remoteNode.children : [];
  }

  remoteManifest.nodes[cacheNode.id] = nextNode;
}

function ensureNodePath(
  remoteManifest: VFSManifest,
  cacheManifest: VFSManifest,
  nodeId: string,
): void {
  const cacheNode = cacheManifest.nodes[nodeId];
  if (!cacheNode) {
    return;
  }

  if (cacheNode.parentId !== null) {
    ensureNodePath(remoteManifest, cacheManifest, cacheNode.parentId);
  }

  if (remoteManifest.nodes[nodeId]) {
    return;
  }

  upsertNodePreservingRemoteChildren(remoteManifest, cacheNode);
  restoreNodePlacement(remoteManifest, cacheManifest, nodeId);
}

function restoreNodePlacement(
  remoteManifest: VFSManifest,
  cacheManifest: VFSManifest,
  nodeId: string,
): void {
  const cacheNode = cacheManifest.nodes[nodeId];
  if (!cacheNode) {
    return;
  }

  const remoteNode = remoteManifest.nodes[nodeId];
  if (!remoteNode) {
    return;
  }

  const parentId =
    cacheNode.parentId !== null &&
    remoteManifest.nodes[cacheNode.parentId]?.type === 'folder'
      ? cacheNode.parentId
      : null;
  remoteNode.parentId = parentId;
  detachNodeFromOtherContainers(remoteManifest, nodeId, parentId);
  addChildIfMissing(remoteManifest, parentId, nodeId);
}

export function applyCachedManifestUpsert(
  remoteManifest: VFSManifest,
  cacheManifest: VFSManifest,
  nodeId: string,
): void {
  const cacheNode = cacheManifest.nodes[nodeId];
  if (!cacheNode) {
    return;
  }

  if (cacheNode.parentId !== null) {
    ensureNodePath(remoteManifest, cacheManifest, cacheNode.parentId);
  }
  upsertNodePreservingRemoteChildren(remoteManifest, cacheNode);
  restoreNodePlacement(remoteManifest, cacheManifest, nodeId);
}

export function getExistingParentId(
  manifest: VFSManifest,
  parentId: string | null,
): string | null {
  if (parentId === null) {
    return null;
  }
  return manifest.nodes[parentId]?.type === 'folder' ? parentId : null;
}

export function getConflictedFileName(name: string, timestamp: Date): string {
  const timestampLabel = [
    timestamp.getFullYear(),
    String(timestamp.getMonth() + 1).padStart(2, '0'),
    String(timestamp.getDate()).padStart(2, '0'),
    String(timestamp.getHours()).padStart(2, '0'),
    String(timestamp.getMinutes()).padStart(2, '0'),
  ].join('');
  const dotIndex = name.lastIndexOf('.');
  const suffix = ` (Conflicted copy ${timestampLabel})`;

  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return `${name}${suffix}`;
  }

  return `${name.slice(0, dotIndex)}${suffix}${name.slice(dotIndex)}`;
}
