import { describe, expect, it, vi } from 'vitest';
import type {
  Repository,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
  YjsSyncSnapshot,
} from '@/lib/sync';
import { ElementType } from '../../elements/element-type';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../../elements/page-frame-constants';
import { YDocManager } from '../../ydoc-manager';
import {
  resolveNoteLinkIdByTitle,
  resolveNoteLinkRefByTitle,
  searchNoteLinkAutocompleteItems,
} from './resolution';

function createFolderNode(
  id: string,
  name: string,
  parentId: string | null = null,
): VFSFolderNode {
  return {
    id,
    name,
    type: 'folder',
    parentId,
    children: [],
    tags: [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

function createFileNode(
  id: string,
  name: string,
  parentId: string | null,
): VFSFileNode {
  return {
    id,
    name,
    type: 'file',
    fileType: 'mcanvas',
    parentId,
    tags: [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

// searchNodes returns ranked results ({ node, score, contentSnippet }); these
// resolution tests only care about the nodes, so wrap fixtures with this.
function toResult(node: VFSNode) {
  return { node, score: 1, contentSnippet: null, matchedTerms: [] };
}

function createSnapshot(update: Uint8Array | null): YjsSyncSnapshot {
  return {
    update,
    stateVector: new Uint8Array(),
    revision: null,
  };
}

function createPageFrameUpdate(displayNames: readonly string[]): Uint8Array {
  const ydoc = new YDocManager();
  displayNames.forEach((displayName, index) => {
    ydoc.createElementMap(ElementType.PAGE_FRAME, `frame-${index}`, {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      displayName,
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
    });
  });
  return ydoc.encodeState();
}

describe('resolveNoteLinkIdByTitle', () => {
  it('resolves slash-delimited note targets by folder path and title', async () => {
    const projectFolder = createFolderNode('folder-projects', 'Projects');
    const archiveFolder = createFolderNode('folder-archive', 'Archive');
    const repository = {
      searchNodes: vi.fn(async () =>
        [
          createFileNode('note-project', 'Alpha', projectFolder.id),
          createFileNode('note-archive', 'Alpha', archiveFolder.id),
        ].map(toResult),
      ),
      getFolderChain: vi.fn(async (folderId: string | null) => {
        if (folderId === projectFolder.id) {
          return [projectFolder];
        }
        if (folderId === archiveFolder.id) {
          return [archiveFolder];
        }
        return [];
      }),
    } satisfies Pick<Repository, 'searchNodes' | 'getFolderChain'>;

    await expect(
      resolveNoteLinkIdByTitle(repository, 'Archive/Alpha'),
    ).resolves.toBe('note-archive');

    expect(repository.searchNodes).toHaveBeenCalledWith('Alpha');
  });

  it('resolves note targets with page-frame names by note title', async () => {
    const repository = {
      searchNodes: vi.fn(async () =>
        [createFileNode('note-alpha', 'Alpha', null)].map(toResult),
      ),
      getFolderChain: vi.fn(async () => []),
    } satisfies Pick<Repository, 'searchNodes' | 'getFolderChain'>;

    await expect(
      resolveNoteLinkIdByTitle(repository, 'Alpha#Research Notes'),
    ).resolves.toBe('note-alpha');

    expect(repository.searchNodes).toHaveBeenCalledWith('Alpha');
    expect(repository.getFolderChain).not.toHaveBeenCalled();
  });

  it('resolves path targets with page-frame names by folder path and title', async () => {
    const archiveFolder = createFolderNode('folder-archive', 'Archive');
    const repository = {
      searchNodes: vi.fn(async () =>
        [createFileNode('note-archive', 'Alpha', archiveFolder.id)].map(
          toResult,
        ),
      ),
      getFolderChain: vi.fn(async () => [archiveFolder]),
    } satisfies Pick<Repository, 'searchNodes' | 'getFolderChain'>;

    await expect(
      resolveNoteLinkIdByTitle(repository, 'Archive/Alpha#Research Notes'),
    ).resolves.toBe('note-archive');

    expect(repository.searchNodes).toHaveBeenCalledWith('Alpha');
  });

  it('keeps title-only resolution on exact note names', async () => {
    const repository = {
      searchNodes: vi.fn(async () =>
        [
          createFileNode('note-first', 'Alpha', null),
          createFileNode('note-second', 'Alpha', 'folder-1'),
        ].map(toResult),
      ),
      getFolderChain: vi.fn(async () => []),
    } satisfies Pick<Repository, 'searchNodes' | 'getFolderChain'>;

    await expect(resolveNoteLinkIdByTitle(repository, 'Alpha')).resolves.toBe(
      'note-first',
    );

    expect(repository.getFolderChain).not.toHaveBeenCalled();
  });
});

describe('searchNoteLinkAutocompleteItems', () => {
  it('filters path queries by folder path and inserts the full path', async () => {
    const projectFolder = createFolderNode('folder-projects', 'Projects');
    const archiveFolder = createFolderNode('folder-archive', 'Archive');
    const repository = {
      searchNodes: vi.fn(async () =>
        [
          createFileNode('note-project', 'Alpha', projectFolder.id),
          createFileNode('note-archive', 'Alpha', archiveFolder.id),
        ].map(toResult),
      ),
      getFolderChain: vi.fn(async (folderId: string | null) => {
        if (folderId === projectFolder.id) {
          return [projectFolder];
        }
        if (folderId === archiveFolder.id) {
          return [archiveFolder];
        }
        return [];
      }),
    } satisfies Pick<Repository, 'searchNodes' | 'getFolderChain'>;

    const items = await searchNoteLinkAutocompleteItems(
      repository,
      'Projects/Al',
      8,
      new AbortController().signal,
    );

    expect(repository.searchNodes).toHaveBeenCalledWith('Al');
    expect(items).toEqual([
      {
        id: 'note-project',
        title: 'Alpha',
        subtitle: 'Projects',
        insertText: 'Projects/Alpha',
      },
    ]);
  });

  it('inserts paths for duplicate title suggestions', async () => {
    const projectFolder = createFolderNode('folder-projects', 'Projects');
    const archiveFolder = createFolderNode('folder-archive', 'Archive');
    const nodes: VFSNode[] = [
      createFileNode('note-project', 'Alpha', projectFolder.id),
      createFileNode('note-archive', 'Alpha', archiveFolder.id),
      createFileNode('note-beta', 'Beta', projectFolder.id),
    ];
    const repository = {
      searchNodes: vi.fn(async () => nodes.map(toResult)),
      getFolderChain: vi.fn(async (folderId: string | null) => {
        if (folderId === projectFolder.id) {
          return [projectFolder];
        }
        if (folderId === archiveFolder.id) {
          return [archiveFolder];
        }
        return [];
      }),
    } satisfies Pick<Repository, 'searchNodes' | 'getFolderChain'>;

    const items = await searchNoteLinkAutocompleteItems(
      repository,
      'Alpha',
      8,
      new AbortController().signal,
    );

    expect(items).toEqual([
      {
        id: 'note-project',
        title: 'Alpha',
        subtitle: 'Projects',
        insertText: 'Projects/Alpha',
      },
      {
        id: 'note-archive',
        title: 'Alpha',
        subtitle: 'Archive',
        insertText: 'Archive/Alpha',
      },
      {
        id: 'note-beta',
        title: 'Beta',
        subtitle: 'Projects',
        insertText: 'Beta',
      },
    ]);
  });

  it('suggests page-frame names after a note target fragment', async () => {
    const repository = {
      searchNodes: vi.fn(async () =>
        [createFileNode('note-alpha', 'Alpha', null)].map(toResult),
      ),
      getFolderChain: vi.fn(async () => []),
      loadDocument: vi.fn(async () =>
        createSnapshot(createPageFrameUpdate(['Research Notes', 'Draft'])),
      ),
    };

    const items = await searchNoteLinkAutocompleteItems(
      repository,
      'Alpha#Re',
      8,
      new AbortController().signal,
    );

    expect(repository.searchNodes).toHaveBeenCalledWith('Alpha');
    expect(repository.loadDocument).toHaveBeenCalledWith('note-alpha');
    expect(items).toEqual([
      {
        id: 'note-alpha',
        title: 'Research Notes',
        subtitle: 'Alpha - Root',
        detail: 'Frame',
        insertText: 'Alpha#Research Notes',
        pageFrameId: 'frame-0',
      },
    ]);
  });

  it('escapes hash in suggested frame names but leaves pipe alone', async () => {
    const repository = {
      searchNodes: vi.fn(async () =>
        [createFileNode('note-alpha', 'Alpha', null)].map(toResult),
      ),
      getFolderChain: vi.fn(async () => []),
      loadDocument: vi.fn(async () =>
        createSnapshot(createPageFrameUpdate(['Plan #2 | draft'])),
      ),
    };

    const items = await searchNoteLinkAutocompleteItems(
      repository,
      'Alpha#Plan',
      8,
      new AbortController().signal,
    );

    expect(items).toEqual([
      {
        id: 'note-alpha',
        title: 'Plan #2 | draft',
        subtitle: 'Alpha - Root',
        detail: 'Frame',
        insertText: 'Alpha#Plan \\#2 | draft',
        pageFrameId: 'frame-0',
      },
    ]);
  });

  it('resolves frame queries with escaped hash in note target', async () => {
    const repository = {
      searchNodes: vi.fn(async () =>
        [createFileNode('note-alpha', 'A#B', null)].map(toResult),
      ),
      getFolderChain: vi.fn(async () => []),
      loadDocument: vi.fn(async () =>
        createSnapshot(createPageFrameUpdate(['Research Notes'])),
      ),
    };

    const items = await searchNoteLinkAutocompleteItems(
      repository,
      'A\\#B#Re',
      8,
      new AbortController().signal,
    );

    expect(repository.searchNodes).toHaveBeenCalledWith('A#B');
    expect(items).toEqual([
      {
        id: 'note-alpha',
        title: 'Research Notes',
        subtitle: 'A#B - Root',
        detail: 'Frame',
        insertText: 'A\\#B#Research Notes',
        pageFrameId: 'frame-0',
      },
    ]);
  });

  it('suggests page-frame names for slash-delimited note targets', async () => {
    const projectFolder = createFolderNode('folder-projects', 'Projects');
    const repository = {
      searchNodes: vi.fn(async () =>
        [createFileNode('note-project', 'Alpha', projectFolder.id)].map(
          toResult,
        ),
      ),
      getFolderChain: vi.fn(async () => [projectFolder]),
      loadDocument: vi.fn(async () =>
        createSnapshot(createPageFrameUpdate(['Data Frame', 'Notes'])),
      ),
    };

    const items = await searchNoteLinkAutocompleteItems(
      repository,
      'Projects/Al#Da',
      8,
      new AbortController().signal,
    );

    expect(repository.searchNodes).toHaveBeenCalledWith('Al');
    expect(items).toEqual([
      {
        id: 'note-project',
        title: 'Data Frame',
        subtitle: 'Alpha - Projects',
        detail: 'Frame',
        insertText: 'Projects/Alpha#Data Frame',
        pageFrameId: 'frame-0',
      },
    ]);
  });
});

describe('resolveNoteLinkRefByTitle', () => {
  it('returns noteId only when target has no page-frame fragment', async () => {
    const repository = {
      searchNodes: vi.fn(async () =>
        [createFileNode('note-alpha', 'Alpha', null)].map(toResult),
      ),
      getFolderChain: vi.fn(async () => []),
    };

    await expect(
      resolveNoteLinkRefByTitle(repository, 'Alpha'),
    ).resolves.toEqual({ noteId: 'note-alpha', pageFrameId: null });
  });

  it('resolves both noteId and pageFrameId by matching displayName', async () => {
    const repository = {
      searchNodes: vi.fn(async () =>
        [createFileNode('note-alpha', 'Alpha', null)].map(toResult),
      ),
      getFolderChain: vi.fn(async () => []),
      loadDocument: vi.fn(async () =>
        createSnapshot(createPageFrameUpdate(['Research Notes', 'Draft'])),
      ),
    };

    await expect(
      resolveNoteLinkRefByTitle(repository, 'Alpha#Draft'),
    ).resolves.toEqual({ noteId: 'note-alpha', pageFrameId: 'frame-1' });
  });

  it('matches frame names containing hash via escape and pipe as literal', async () => {
    const repository = {
      searchNodes: vi.fn(async () =>
        [createFileNode('note-alpha', 'Alpha', null)].map(toResult),
      ),
      getFolderChain: vi.fn(async () => []),
      loadDocument: vi.fn(async () =>
        createSnapshot(createPageFrameUpdate(['Plan #2 | draft'])),
      ),
    };

    await expect(
      resolveNoteLinkRefByTitle(repository, 'Alpha#Plan \\#2 | draft'),
    ).resolves.toEqual({ noteId: 'note-alpha', pageFrameId: 'frame-0' });
  });

  it('returns null pageFrameId when no displayName matches', async () => {
    const repository = {
      searchNodes: vi.fn(async () =>
        [createFileNode('note-alpha', 'Alpha', null)].map(toResult),
      ),
      getFolderChain: vi.fn(async () => []),
      loadDocument: vi.fn(async () =>
        createSnapshot(createPageFrameUpdate(['Research Notes'])),
      ),
    };

    await expect(
      resolveNoteLinkRefByTitle(repository, 'Alpha#Missing'),
    ).resolves.toEqual({ noteId: 'note-alpha', pageFrameId: null });
  });

  it('caches loadDocument results across repeated lookups', async () => {
    const repository = {
      searchNodes: vi.fn(async () =>
        [createFileNode('note-alpha', 'Alpha', null)].map(toResult),
      ),
      getFolderChain: vi.fn(async () => []),
      loadDocument: vi.fn(async () =>
        createSnapshot(createPageFrameUpdate(['Draft'])),
      ),
    };
    const cache = new Map();

    await resolveNoteLinkRefByTitle(repository, 'Alpha#Draft', cache);
    await resolveNoteLinkRefByTitle(repository, 'Alpha#Draft', cache);

    expect(repository.loadDocument).toHaveBeenCalledTimes(1);
  });
});
