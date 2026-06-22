import type { Repository, VFSNodeId } from '@/lib/sync';

/** Drop the last '/'-separated segment, yielding the parent folder path. */
export function getParentPath(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
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
