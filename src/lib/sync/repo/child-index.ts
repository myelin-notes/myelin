import type { VFSManifest } from './shared';

/**
 * Adjacency index derived from each node's `parentId`, which is the only stored record of
 * parentage. Exists so listing a folder stays proportional to its children instead of scanning
 * every node. Never persisted or synced, so a node can't be filed under a parent that doesn't
 * list it back.
 *
 * Built lazily per manifest object, so a freshly parsed or `structuredClone`d manifest rebuilds on
 * first read. Callers keep it current through `addChild`/`removeChild`/`dropNode`.
 */
type ChildIndex = Map<string | null, Set<string>>;

const indexes = new WeakMap<VFSManifest, ChildIndex>();
const EMPTY: readonly string[] = [];

function canHoldChildren(
  manifest: VFSManifest,
  parentId: string | null,
): boolean {
  return parentId === null || manifest.nodes[parentId]?.type === 'folder';
}

function buildIndex(manifest: VFSManifest): ChildIndex {
  const index: ChildIndex = new Map();
  for (const node of Object.values(manifest.nodes)) {
    // A node whose parent is missing or is a file is unreachable from the root and stays out of every
    // listing.
    if (!canHoldChildren(manifest, node.parentId)) {
      continue;
    }
    let bucket = index.get(node.parentId);
    if (!bucket) {
      bucket = new Set();
      index.set(node.parentId, bucket);
    }
    bucket.add(node.id);
  }
  return index;
}

function getIndex(manifest: VFSManifest): ChildIndex {
  let index = indexes.get(manifest);
  if (!index) {
    index = buildIndex(manifest);
    indexes.set(manifest, index);
  }
  return index;
}

// A snapshot: callers walk subtrees while deleting from the index, which would otherwise mutate
// under iteration.
export function getChildIds(
  manifest: VFSManifest,
  parentId: string | null,
): readonly string[] {
  const bucket = getIndex(manifest).get(parentId);
  return bucket ? [...bucket] : EMPTY;
}

/** Files `childId` under `parentId`. The caller owns setting `node.parentId`. */
export function addChild(
  manifest: VFSManifest,
  parentId: string | null,
  childId: string,
): void {
  if (!canHoldChildren(manifest, parentId)) {
    return;
  }
  const index = getIndex(manifest);
  let bucket = index.get(parentId);
  if (!bucket) {
    bucket = new Set();
    index.set(parentId, bucket);
  }
  bucket.add(childId);
}

// Leaves `node.parentId` to the caller. Forces the index to exist first — callers unfile a node
// while its `parentId` still names the old parent, so skipping the build would let a later one
// derive the stale parentage straight back out of the node.
export function removeChild(
  manifest: VFSManifest,
  parentId: string | null,
  childId: string,
): void {
  getIndex(manifest).get(parentId)?.delete(childId);
}

/** Discards a folder's bucket once the folder is gone from `manifest.nodes`. */
export function dropNode(manifest: VFSManifest, nodeId: string): void {
  getIndex(manifest).delete(nodeId);
}
