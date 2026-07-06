import {
  getMimeTypeForFileType,
  isImageFileType,
  isVideoFileType,
  type Repository,
  type VFSFileNode,
  type VFSNodeId,
} from '../../sync/core';
import type { PageFrameAutocompleteItem } from '../pm/autocomplete';
import type { ResolveMediaSrc } from '../pm/embed/renderer';

export type MediaPathResolveSource = Pick<
  Repository,
  'listDirectory' | 'readFileBytes'
>;
export type MediaPathSearchSource = Pick<Repository, 'listDirectory'>;

function isMediaFile(file: VFSFileNode): boolean {
  return isImageFileType(file.fileType) || isVideoFileType(file.fileType);
}

// Paths are stored as literal VFS names — `![](/My Pics/cat.png)` matches the
// folder "My Pics" / file "cat.png" verbatim, with no percent-encoding. `/`
// always separates segments (filesystems disallow it in names).
function splitMediaPath(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

async function resolveFolderId(
  repository: MediaPathSearchSource,
  folderNames: readonly string[],
  signal?: AbortSignal,
): Promise<{ parentId: VFSNodeId | null; names: string[] } | null> {
  let parentId: VFSNodeId | null = null;
  const names: string[] = [];
  for (const name of folderNames) {
    const [folders] = await repository.listDirectory(parentId);
    if (signal?.aborted) {
      return null;
    }
    const next = folders.find((folder) => folder.name === name);
    if (!next) {
      return null;
    }
    parentId = next.id;
    names.push(next.name);
  }
  return { parentId, names };
}

/** Resolve a library path like `/Folder/image.png` to its file node. */
export async function resolveLibraryMediaNode(
  repository: MediaPathResolveSource,
  path: string,
): Promise<VFSFileNode | null> {
  const segments = splitMediaPath(path);
  if (segments.length === 0) {
    return null;
  }

  const fileName = segments[segments.length - 1];
  const folder = await resolveFolderId(repository, segments.slice(0, -1));
  if (!folder) {
    return null;
  }

  const [, files] = await repository.listDirectory(folder.parentId);
  return files.find((file) => file.name === fileName) ?? null;
}

/**
 * Build a resolver that turns a `/`-rooted library path into a renderable
 * object URL. Returns `null` when the path does not point at an existing
 * image/video so the embed can fall back to showing the raw path.
 */
export function createMediaPathResolver(
  repository: MediaPathResolveSource,
): ResolveMediaSrc {
  return async (path) => {
    const node = await resolveLibraryMediaNode(repository, path);
    if (!node) {
      return null;
    }

    const kind = isImageFileType(node.fileType)
      ? 'image'
      : isVideoFileType(node.fileType)
        ? 'video'
        : null;
    if (!kind) {
      return null;
    }

    const bytes = await repository.readFileBytes(node.id);
    if (!bytes || bytes.byteLength === 0) {
      return null;
    }

    const blob = new Blob([bytes], {
      type: getMimeTypeForFileType(node.fileType),
    });
    const url = URL.createObjectURL(blob);
    return {
      url,
      kind,
      revoke: () => URL.revokeObjectURL(url),
    };
  };
}

interface MediaPathQuery {
  folderNames: string[];
  namePart: string;
}

function parseMediaPathQuery(query: string): MediaPathQuery {
  const lastSlash = query.lastIndexOf('/');
  return {
    folderNames: splitMediaPath(query.slice(0, lastSlash + 1)),
    namePart: query.slice(lastSlash + 1),
  };
}

/**
 * Autocomplete the path inside `![](/…)`: folders (so the user can drill in)
 * and image/video files within the folder typed so far, prefix-filtered by the
 * trailing path segment.
 */
export async function searchMediaPathAutocompleteItems(
  repository: MediaPathSearchSource,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<readonly PageFrameAutocompleteItem[]> {
  const { folderNames, namePart } = parseMediaPathQuery(query);

  const folder = await resolveFolderId(repository, folderNames, signal);
  if (!folder || signal.aborted) {
    return [];
  }

  const [folders, files] = await repository.listDirectory(folder.parentId);
  if (signal.aborted) {
    return [];
  }

  const dirPath =
    folder.names.length === 0 ? '/' : `/${folder.names.join('/')}/`;
  const normalizedName = namePart.toLocaleLowerCase();
  const matchesName = (name: string): boolean =>
    name.toLocaleLowerCase().startsWith(normalizedName);

  const folderItems = folders
    .filter((node) => matchesName(node.name))
    .map((node) => ({
      id: node.id,
      title: node.name,
      detail: 'Folder',
      iconKind: 'folder' as const,
      insertText: `${dirPath}${node.name}/`,
    }));

  const fileItems = files
    .filter((node) => isMediaFile(node) && matchesName(node.name))
    .map((node) => ({
      id: node.id,
      title: node.name,
      detail: node.fileType,
      iconKind: isImageFileType(node.fileType)
        ? ('image' as const)
        : ('video' as const),
      insertText: `${dirPath}${node.name}`,
    }));

  return [...folderItems, ...fileItems].slice(0, limit);
}
