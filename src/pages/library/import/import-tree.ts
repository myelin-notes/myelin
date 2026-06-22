import type { Repository, VFSNodeId } from '@/lib/sync';
import type { ConflictResolution } from './dialog';

/** Drop the last '/'-separated segment, yielding the parent folder path. */
export function getParentPath(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

/** Last path segment, normalized, or `fallback` if the path has no usable name. */
export function getPathBasename(path: string, fallback: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').pop()?.trim() || fallback;
}

/**
 * Resolve the name to give an imported root folder when one already exists.
 * `replace` deletes the existing folder and keeps the name; `rename` returns a
 * unique sibling name (e.g. "Name 2") so both are kept. No conflict → name as-is.
 */
export async function resolveImportRootName({
  repository,
  parentId,
  name,
  conflictNodeId,
  conflictResolution,
}: {
  repository: Repository;
  parentId: VFSNodeId | null;
  name: string;
  conflictNodeId: VFSNodeId | null;
  conflictResolution: ConflictResolution;
}): Promise<string> {
  if (!conflictNodeId) {
    return name;
  }
  if (conflictResolution === 'replace') {
    await repository.deleteNode(conflictNodeId);
    return name;
  }
  return repository.getUniqueFileName(name, parentId);
}

/**
 * Create every folder in `folderPaths` under `rootParentId` (parents before
 * children), returning a map from relative folder path to its created node id.
 * `rootParentId` may be null to create top-level folders at the library root.
 */
export async function createImportedFolders(
  repository: Repository,
  rootParentId: VFSNodeId | null,
  folderPaths: Set<string>,
): Promise<Map<string, VFSNodeId>> {
  const folderIds = new Map<string, VFSNodeId>();
  const sorted = [...folderPaths].sort(
    (left, right) =>
      left.split('/').length - right.split('/').length ||
      left.localeCompare(right),
  );

  for (const folderPath of sorted) {
    const parentPath = getParentPath(folderPath);
    const parentId = parentPath ? folderIds.get(parentPath) : rootParentId;
    const name = folderPath.split('/').pop();
    if (!name) {
      continue;
    }
    folderIds.set(
      folderPath,
      await repository.createFolder(name, parentId ?? null),
    );
  }

  return folderIds;
}

/** Resolve the import target folder id for a file living at `folderPath`. */
export function getImportParentId(
  rootParentId: VFSNodeId | null,
  folderIds: ReadonlyMap<string, VFSNodeId>,
  folderPath: string,
): VFSNodeId | null {
  return folderPath
    ? (folderIds.get(folderPath) ?? rootParentId)
    : rootParentId;
}
