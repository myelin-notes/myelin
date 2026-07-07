import { describe, expect, it } from 'vitest';
import type {
  FileType,
  VFSFileNode,
  VFSFolderNode,
  VFSNodeId,
} from '../../sync/repo/types';
import {
  type MediaPathResolveSource,
  resolveLibraryMediaNode,
  searchMediaPathAutocompleteItems,
} from './resolution';

function folder(id: string, name: string): VFSFolderNode {
  return {
    id,
    name,
    type: 'folder',
    parentId: null,
    children: [],
    tags: [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

function file(id: string, name: string, fileType: FileType): VFSFileNode {
  return {
    id,
    name,
    type: 'file',
    fileType,
    parentId: null,
    tags: [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

// parentId (null = root) -> [folders, files]
const TREE: Record<string, [VFSFolderNode[], VFSFileNode[]]> = {
  root: [
    [folder('f-animals', 'Animals'), folder('f-pics', 'My Pics')],
    [file('file-banner', 'banner.png', 'png')],
  ],
  'f-animals': [
    [folder('f-wild', 'Wild')],
    [
      file('file-cat', 'cat.png', 'png'),
      file('file-dog', 'dog.jpg', 'jpg'),
      file('file-notes', 'notes.mcanvas', 'mcanvas'),
    ],
  ],
  'f-wild': [[], [file('file-lion', 'lion.mp4', 'mp4')]],
  'f-pics': [[], [file('file-mycat', 'my cat.png', 'png')]],
};

const repository: MediaPathResolveSource = {
  listDirectory: (folderId: VFSNodeId | null) =>
    Promise.resolve(TREE[folderId ?? 'root'] ?? [[], []]),
  readFileBytes: () => Promise.resolve(null),
};

function search(query: string) {
  return searchMediaPathAutocompleteItems(
    repository,
    query,
    20,
    new AbortController().signal,
  );
}

describe('searchMediaPathAutocompleteItems', () => {
  it('lists root folders and media files for `/`', async () => {
    const items = await search('/');
    expect(items).toEqual([
      {
        id: 'f-animals',
        title: 'Animals',
        detail: 'Folder',
        iconKind: 'folder',
        insertText: '/Animals/',
      },
      {
        id: 'f-pics',
        title: 'My Pics',
        detail: 'Folder',
        iconKind: 'folder',
        insertText: '/My Pics/',
      },
      {
        id: 'file-banner',
        title: 'banner.png',
        detail: 'png',
        iconKind: 'image',
        insertText: '/banner.png',
      },
    ]);
  });

  it('lists a subfolder and excludes non-media files', async () => {
    const items = await search('/Animals/');
    expect(items.map((item) => item.title)).toEqual([
      'Wild',
      'cat.png',
      'dog.jpg',
    ]);
    expect(items.map((item) => item.title)).not.toContain('notes.mcanvas');
  });

  it('prefix-filters by the trailing path segment', async () => {
    const items = await search('/Animals/d');
    expect(items.map((item) => item.title)).toEqual(['dog.jpg']);
  });

  it('keeps spaces literal in typed and inserted paths', async () => {
    const items = await search('/My Pics/');
    expect(items).toEqual([
      {
        id: 'file-mycat',
        title: 'my cat.png',
        detail: 'png',
        iconKind: 'image',
        insertText: '/My Pics/my cat.png',
      },
    ]);
  });

  it('returns nothing when a folder in the path is missing', async () => {
    expect(await search('/Nope/')).toEqual([]);
  });
});

describe('resolveLibraryMediaNode', () => {
  it('resolves a nested media file by path', async () => {
    const node = await resolveLibraryMediaNode(
      repository,
      '/Animals/Wild/lion.mp4',
    );
    expect(node?.id).toBe('file-lion');
  });

  it('resolves names containing spaces directly', async () => {
    const node = await resolveLibraryMediaNode(
      repository,
      '/My Pics/my cat.png',
    );
    expect(node?.id).toBe('file-mycat');
  });

  it('returns null for a missing file or folder', async () => {
    expect(
      await resolveLibraryMediaNode(repository, '/Animals/missing.png'),
    ).toBeNull();
    expect(await resolveLibraryMediaNode(repository, '/Nope/x.png')).toBeNull();
  });
});
