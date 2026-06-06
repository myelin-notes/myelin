import {
  escapeNoteLinkPath,
  escapeNoteLinkSegment,
  splitNoteLinkTargetFrame,
  unescapeNoteLinkSegment,
} from '@/lib/note/link-syntax';
import { parseNoteLinkTarget } from '@/lib/note/link-target';
import type {
  Repository,
  VFSFileNode,
  VFSNode,
  VFSNodeId,
  YjsSyncTarget,
} from '@/lib/sync';
import { ElementType } from '../../elements/element-type';
import { normalizePageFrameDisplayName } from '../../elements/page-frame-constants';
import { YDocManager } from '../../ydoc-manager';
import type { PageFrameAutocompleteItem } from '../pm/autocomplete';

export type NoteLinkResolveSource = Pick<
  Repository,
  'searchNodes' | 'getFolderChain'
>;
export type NoteLinkSearchSource = Pick<
  Repository,
  'searchNodes' | 'getFolderChain'
> &
  Partial<Pick<YjsSyncTarget, 'loadDocument'>>;
export type NoteLinkRefResolveSource = NoteLinkResolveSource &
  Partial<Pick<YjsSyncTarget, 'loadDocument'>>;

export interface NoteLinkRef {
  noteId: VFSNodeId | null;
  pageFrameId: string | null;
}

export interface PageFrameMeta {
  id: string;
  displayName: string;
}

export type PageFrameNameCache = Map<VFSNodeId, readonly PageFrameMeta[]>;

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

interface NoteLinkPageFrameQuery {
  noteQuery: string;
  pageFrameQuery: string;
}

function parseNoteLinkQuery(query: string): NoteLinkPathQuery {
  const segments = query
    .split('/')
    .map((segment) => unescapeNoteLinkSegment(segment).trim());
  if (segments.length <= 1) {
    return {
      isPath: false,
      noteQuery: segments[0] ?? '',
      pathQuery: segments[0] ?? '',
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

function parseNoteLinkPageFrameQuery(
  query: string,
): NoteLinkPageFrameQuery | null {
  const { noteTarget, frame } = splitNoteLinkTargetFrame(query);
  if (frame === null) {
    return null;
  }

  const noteQuery = noteTarget.trim();
  if (!noteQuery) {
    return null;
  }

  return {
    noteQuery,
    pageFrameQuery: unescapeNoteLinkSegment(frame).trim(),
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

function getPageFrameMetas(update: Uint8Array | null): PageFrameMeta[] {
  if (!update || update.byteLength === 0) {
    return [];
  }

  const ydoc = YDocManager.fromUpdate(update);
  const metas: PageFrameMeta[] = [];

  for (let i = 0; i < ydoc.elements.length; i++) {
    const yMap = ydoc.elements.get(i);
    if (yMap.get('type') !== ElementType.PAGE_FRAME) {
      continue;
    }

    const uuid = yMap.get('uuid');
    if (typeof uuid !== 'string') {
      continue;
    }

    metas.push({
      id: uuid,
      displayName: normalizePageFrameDisplayName(yMap.get('displayName')),
    });
  }

  return metas;
}

// todo: probably can avoid searching
export async function resolveNoteLinkIdByTitle(
  repository: NoteLinkResolveSource,
  target: string,
): Promise<VFSNodeId | null> {
  const parsedTarget = parseNoteLinkTarget(target);
  if (!parsedTarget) {
    return null;
  }

  const matches = await repository.searchNodes(parsedTarget.noteName);
  const notes = matches.map((result) => result.node).filter(isCanvasNote);
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

async function loadFrameMetas(
  loadDocument: NonNullable<YjsSyncTarget['loadDocument']>,
  noteId: VFSNodeId,
  cache?: PageFrameNameCache,
): Promise<readonly PageFrameMeta[]> {
  const cached = cache?.get(noteId);
  if (cached) {
    return cached;
  }
  const snapshot = await loadDocument(noteId);
  const metas = getPageFrameMetas(snapshot.update);
  cache?.set(noteId, metas);
  return metas;
}

export async function resolveNoteLinkRefByTitle(
  repository: NoteLinkRefResolveSource,
  target: string,
  cache?: PageFrameNameCache,
): Promise<NoteLinkRef> {
  const parsedTarget = parseNoteLinkTarget(target);
  if (!parsedTarget) {
    return { noteId: null, pageFrameId: null };
  }

  const noteId = await resolveNoteLinkIdByTitle(repository, target);
  if (!noteId || !parsedTarget.pageFrameName) {
    return { noteId, pageFrameId: null };
  }

  const loadDocument = repository.loadDocument;
  if (!loadDocument) {
    return { noteId, pageFrameId: null };
  }

  const frames = await loadFrameMetas(loadDocument, noteId, cache);
  const targetName = parsedTarget.pageFrameName;
  const frame = frames.find((meta) => meta.displayName === targetName);
  return { noteId, pageFrameId: frame?.id ?? null };
}

export async function searchNoteLinkAutocompleteItems(
  repository: NoteLinkSearchSource,
  query: string,
  limit: number,
  signal: AbortSignal,
  frameNameCache?: PageFrameNameCache,
): Promise<readonly PageFrameAutocompleteItem[]> {
  const pageFrameQuery = parseNoteLinkPageFrameQuery(query);
  if (pageFrameQuery) {
    return searchNoteLinkPageFrameAutocompleteItems(
      repository,
      pageFrameQuery,
      limit,
      signal,
      frameNameCache,
    );
  }

  return searchNoteAutocompleteItems(repository, query, limit, signal);
}

async function searchNoteAutocompleteItems(
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

  const notes = matches.map((result) => result.node).filter(isCanvasNote);
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
    const useFullPath =
      parsedQuery.isPath || (titleCounts.get(note.name) ?? 0) > 1;
    return {
      id: note.id,
      title: note.name,
      subtitle: folderPath.split('/').join(' / ') || 'Root',
      insertText: escapeNoteLinkPath(useFullPath ? linkPath : note.name),
    };
  });
}

async function searchNoteLinkPageFrameAutocompleteItems(
  repository: NoteLinkSearchSource,
  query: NoteLinkPageFrameQuery,
  limit: number,
  signal: AbortSignal,
  frameNameCache: PageFrameNameCache | undefined,
): Promise<readonly PageFrameAutocompleteItem[]> {
  const loadDocument = repository.loadDocument;
  if (!loadDocument) {
    return [];
  }

  const noteItems = await searchNoteAutocompleteItems(
    repository,
    query.noteQuery,
    limit,
    signal,
  );
  if (signal.aborted) {
    return [];
  }

  const normalizedFrameQuery = normalizePathQuery(query.pageFrameQuery);
  const matches = await Promise.all(
    noteItems.map(async (noteItem): Promise<PageFrameAutocompleteItem[]> => {
      const frames = await loadFrameMetas(
        loadDocument,
        noteItem.id,
        frameNameCache,
      );
      const noteTarget = noteItem.insertText ?? noteItem.title;

      return frames
        .filter((frame) =>
          normalizePathQuery(frame.displayName).startsWith(
            normalizedFrameQuery,
          ),
        )
        .map((frame) => ({
          id: noteItem.id,
          title: frame.displayName,
          subtitle: noteItem.subtitle
            ? `${noteItem.title} - ${noteItem.subtitle}`
            : noteItem.title,
          detail: 'Frame',
          insertText: `${noteTarget}#${escapeNoteLinkSegment(frame.displayName)}`,
          pageFrameId: frame.id,
        }));
    }),
  );

  if (signal.aborted) {
    return [];
  }

  return matches.flat().slice(0, limit);
}

export function isCanvasNote(node: VFSNode | null): node is VFSFileNode {
  return node?.type === 'file' && node.fileType === 'mcanvas';
}
