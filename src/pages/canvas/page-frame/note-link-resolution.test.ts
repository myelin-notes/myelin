import { describe, expect, it, vi } from 'vitest';
import type {
  Repository,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
} from '@/lib/sync';
import {
  resolveNoteLinkIdByTitle,
  searchNoteLinkAutocompleteItems,
} from './note-link-resolution';

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

describe('resolveNoteLinkIdByTitle', () => {
  it('resolves slash-delimited note targets by folder path and title', async () => {
    const projectFolder = createFolderNode('folder-projects', 'Projects');
    const archiveFolder = createFolderNode('folder-archive', 'Archive');
    const repository = {
      searchNodes: vi.fn(async () => [
        createFileNode('note-project', 'Alpha', projectFolder.id),
        createFileNode('note-archive', 'Alpha', archiveFolder.id),
      ]),
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

  it('keeps title-only resolution on exact note names', async () => {
    const repository = {
      searchNodes: vi.fn(async () => [
        createFileNode('note-first', 'Alpha', null),
        createFileNode('note-second', 'Alpha', 'folder-1'),
      ]),
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
      searchNodes: vi.fn(async () => [
        createFileNode('note-project', 'Alpha', projectFolder.id),
        createFileNode('note-archive', 'Alpha', archiveFolder.id),
      ]),
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
      searchNodes: vi.fn(async () => nodes),
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
        insertText: undefined,
      },
    ]);
  });
});
