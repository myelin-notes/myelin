import { addChild, removeChild } from '../child-index';
import type { RepositorySnapshot, VFSManifest } from '../shared';

export function isSnapshotEmpty(snapshot: RepositorySnapshot): boolean {
  return (
    Object.keys(snapshot.manifest.nodes).length === 0 &&
    Object.keys(snapshot.manifest.linksBySource ?? {}).length === 0 &&
    snapshot.manifest.customColors.length === 0
  );
}

export function detachNodeFromAllContainers(
  manifest: VFSManifest,
  nodeId: string,
): void {
  removeChild(manifest, manifest.nodes[nodeId]?.parentId ?? null, nodeId);
}

/**
 * Copies a node from the cache onto the remote manifest, rooting it when the
 * cache's parent does not exist remotely.
 *
 * Sibling order and membership are no longer carried on the node, so a cache
 * node holding a stale view of a folder's contents can no longer clobber
 * children the remote gained concurrently — those children keep their own
 * `parentId` and stay put.
 */
function upsertNodeFromCache(
  remoteManifest: VFSManifest,
  cacheManifest: VFSManifest,
  nodeId: string,
): void {
  const cacheNode = cacheManifest.nodes[nodeId];
  if (!cacheNode) {
    return;
  }

  const existing = remoteManifest.nodes[nodeId];
  if (existing) {
    removeChild(remoteManifest, existing.parentId, nodeId);
  }

  const nextNode = structuredClone(cacheNode);
  nextNode.parentId =
    cacheNode.parentId !== null &&
    remoteManifest.nodes[cacheNode.parentId]?.type === 'folder'
      ? cacheNode.parentId
      : null;
  remoteManifest.nodes[nodeId] = nextNode;
  addChild(remoteManifest, nextNode.parentId, nodeId);
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

  upsertNodeFromCache(remoteManifest, cacheManifest, nodeId);
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
  upsertNodeFromCache(remoteManifest, cacheManifest, nodeId);
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
