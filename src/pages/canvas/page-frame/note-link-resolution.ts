import type { Repository, VFSFileNode, VFSNode } from '@/lib/sync';
import type { PageFrameAutocompleteItem } from './pm/autocomplete';

export type NoteLinkResolveSource = Pick<
  Repository,
  'searchNodes' | 'getFolderChain'
>;
export type NoteLinkSearchSource = Pick<
  Repository,
  'searchNodes' | 'getFolderChain'
>;

interface NoteLinkPathTarget {
  isPath: boolean;
  noteName: string;
  path: string;
}

interface NoteLinkPathQuery {
  isPath: boolean;
  noteQuery: string;
  pathQuery: string;
}

interface NoteLinkAutocompleteMatch {
  note: VFSFileNode;
  folderPath: string;
  linkPath: string;
}

function parseNoteLinkTarget(target: string): NoteLinkPathTarget | null {
  const segments = target.split('/').map((segment) => segment.trim());
  if (segments.some((segment) => segment.length === 0)) {
    return null;
  }

  const noteName = segments[segments.length - 1];
  if (!noteName) {
    return null;
  }

  return {
    isPath: segments.length > 1,
    noteName,
    path: segments.join('/'),
  };
}

function parseNoteLinkQuery(query: string): NoteLinkPathQuery {
  const segments = query.split('/').map((segment) => segment.trim());
  if (segments.length <= 1) {
    return {
      isPath: false,
      noteQuery: query,
      pathQuery: query,
    };
  }

  const folderSegments = segments.slice(0, -1);
  if (folderSegments.some((segment) => segment.length === 0)) {
    return {
      isPath: true,
      noteQuery: '',
      pathQuery: '',
    };
  }

  return {
    isPath: true,
    noteQuery: segments[segments.length - 1],
    pathQuery: segments.join('/'),
  };
}

function normalizePathQuery(value: string): string {
  return value.toLocaleLowerCase();
}

async function getNoteLinkPath(
  repository: NoteLinkSearchSource,
  note: VFSFileNode,
): Promise<{ folderPath: string; linkPath: string }> {
  const folders = await repository.getFolderChain(note.parentId);
  const folderPath = folders.map((folder) => folder.name).join('/');

  return {
    folderPath,
    linkPath: folderPath ? `${folderPath}/${note.name}` : note.name,
  };
}

// todo: probably can avoid searching
export async function resolveNoteLinkIdByTitle(
  repository: NoteLinkResolveSource,
  target: string,
): Promise<string | null> {
  const parsedTarget = parseNoteLinkTarget(target);
  if (!parsedTarget) {
    return null;
  }

  const matches = await repository.searchNodes(parsedTarget.noteName);
  const notes = matches.filter(isCanvasNote);
  if (!parsedTarget.isPath) {
    const match = notes.find((node) => node.name === parsedTarget.noteName);
    return match?.id ?? null;
  }

  let match: VFSFileNode | undefined;
  for (const note of notes) {
    if (note.name !== parsedTarget.noteName) {
      continue;
    }

    const { linkPath } = await getNoteLinkPath(repository, note);
    if (linkPath === parsedTarget.path) {
      match = note;
      break;
    }
  }

  return match?.id ?? null;
}

export async function searchNoteLinkAutocompleteItems(
  repository: NoteLinkSearchSource,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<readonly PageFrameAutocompleteItem[]> {
  const parsedQuery = parseNoteLinkQuery(query);
  const matches = await repository.searchNodes(parsedQuery.noteQuery);
  if (signal.aborted) {
    return [];
  }

  const notes = matches.filter(isCanvasNote);
  const titleCounts = new Map<string, number>();
  for (const note of notes) {
    titleCounts.set(note.name, (titleCounts.get(note.name) ?? 0) + 1);
  }

  const candidateNotes = parsedQuery.isPath ? notes : notes.slice(0, limit);
  const pathMatches = await Promise.all(
    candidateNotes.map(async (note): Promise<NoteLinkAutocompleteMatch> => {
      const path = await getNoteLinkPath(repository, note);
      return {
        note,
        ...path,
      };
    }),
  );

  if (signal.aborted) {
    return [];
  }

  const matchingNotes = parsedQuery.isPath
    ? pathMatches.filter(({ linkPath }) =>
        normalizePathQuery(linkPath).startsWith(
          normalizePathQuery(parsedQuery.pathQuery),
        ),
      )
    : pathMatches;

  const limitedMatches = parsedQuery.isPath
    ? matchingNotes.slice(0, limit)
    : matchingNotes;

  return limitedMatches.map(({ note, folderPath, linkPath }) => {
    return {
      id: note.id,
      title: note.name,
      subtitle: folderPath.split('/').join(' / ') || 'Root',
      insertText:
        parsedQuery.isPath || (titleCounts.get(note.name) ?? 0) > 1
          ? linkPath
          : undefined,
    };
  });
}

function isCanvasNote(node: VFSNode): node is VFSFileNode {
  return node.type === 'file' && node.fileType === 'mcanvas';
}
