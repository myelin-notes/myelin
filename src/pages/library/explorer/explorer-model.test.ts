import { describe, expect, it, vi } from 'vitest';
import type {
  FileType,
  NodeSearchResult,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
  VFSNodeId,
} from '@/lib/sync';
import {
  ExplorerModel,
  type ExplorerRepository,
  sortExplorerNodes,
} from './explorer-model';

function folder(
  id: string,
  name: string,
  parentId: string | null,
  tags: string[] = [],
): VFSFolderNode {
  return {
    id,
    name,
    type: 'folder',
    parentId,
    tags,
    createdAt: 1,
    modifiedAt: 1,
  };
}

function file(
  id: string,
  name: string,
  parentId: string | null,
  tags: string[] = [],
): VFSFileNode {
  return {
    id,
    name,
    type: 'file',
    fileType: 'mcanvas',
    parentId,
    tags,
    createdAt: 1,
    modifiedAt: 1,
  };
}

function searchResult(node: VFSNode): NodeSearchResult {
  return {
    node,
    score: 1,
    contentSnippet: null,
    matchedTerms: [],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

class TestExplorerRepository implements ExplorerRepository {
  private readonly nodes = new Map<VFSNodeId, VFSNode>();
  private nextId = 1;

  constructor(nodes: readonly VFSNode[]) {
    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }
  }

  async getNode(nodeId: VFSNodeId): Promise<VFSNode | null> {
    return this.nodes.get(nodeId) ?? null;
  }

  async listDirectory(
    folderId: VFSNodeId | null,
  ): Promise<[VFSFolderNode[], VFSFileNode[]]> {
    const folders: VFSFolderNode[] = [];
    const files: VFSFileNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.parentId !== folderId) {
        continue;
      }
      if (node.type === 'folder') {
        folders.push(node);
      } else {
        files.push(node);
      }
    }
    return [folders, files];
  }

  async getFolderChain(folderId: VFSNodeId | null): Promise<VFSFolderNode[]> {
    const chain: VFSFolderNode[] = [];
    let current = folderId === null ? null : this.nodes.get(folderId);
    while (current?.type === 'folder') {
      chain.unshift(current);
      current =
        current.parentId === null ? null : this.nodes.get(current.parentId);
    }
    return chain;
  }

  async getTemplatesRoot(): Promise<VFSFolderNode | null> {
    for (const node of this.nodes.values()) {
      if (node.type === 'folder' && node.system?.kind === 'templates-root') {
        return node;
      }
    }
    return null;
  }

  async searchNodes(query: string): Promise<NodeSearchResult[]> {
    return [...this.nodes.values()]
      .filter((node) => node.name.toLowerCase().includes(query.toLowerCase()))
      .map(searchResult);
  }

  async getNodesByAnyTag(
    tags: string[],
    folderId: VFSNodeId | null = null,
  ): Promise<VFSNode[]> {
    return [...this.nodes.values()].filter(
      (node) =>
        (folderId === null || node.parentId === folderId) &&
        node.tags.some((tag) => tags.includes(tag)),
    );
  }

  async getUniqueFileName(baseName: string): Promise<string> {
    return baseName;
  }

  async createFolder(
    name: string,
    parentId: VFSNodeId | null,
  ): Promise<VFSNodeId> {
    const id = `folder-${this.nextId++}`;
    this.nodes.set(id, folder(id, name, parentId));
    return id;
  }

  async createFile(
    name: string,
    fileType: FileType,
    parentId: VFSNodeId | null,
  ): Promise<VFSNodeId> {
    const id = `file-${this.nextId++}`;
    this.nodes.set(id, {
      ...file(id, name, parentId),
      fileType,
    });
    return id;
  }
}

function createModel(repository: TestExplorerRepository): ExplorerModel {
  return new ExplorerModel(repository, (name, parentId) =>
    repository.createFile(name, 'mcanvas', parentId),
  );
}

const explorerConfigurations = [
  {
    name: 'workspace tree',
    folderId: null,
    expectedDirectory: ['work', 'root note', 'needle note'],
    expectedTagged: ['root note', 'work note'],
  },
  {
    name: 'current folder',
    folderId: 'work',
    expectedDirectory: ['work note'],
    expectedTagged: ['work note'],
  },
] as const;

describe('ExplorerModel', () => {
  for (const configuration of explorerConfigurations) {
    it(`shares workflow commands for the ${configuration.name}`, async () => {
      const repository = new TestExplorerRepository([
        folder('work', 'work', null),
        file('root-note', 'root note', null, ['work']),
        file('work-note', 'work note', 'work', ['work']),
        file('needle', 'needle note', null, ['search']),
      ]);
      const model = createModel(repository);

      const directory = await model.refresh({
        folderId: configuration.folderId,
        searchQuery: '',
        filterTags: [],
      });
      expect(directory?.nodes.map((node) => node.name)).toEqual(
        configuration.expectedDirectory,
      );

      const tagged = await model.refresh({
        folderId: configuration.folderId,
        searchQuery: '',
        filterTags: ['work'],
      });
      expect(tagged?.nodes.map((node) => node.name)).toEqual(
        configuration.expectedTagged,
      );

      const searched = await model.refresh({
        folderId: configuration.folderId,
        searchQuery: 'needle',
        filterTags: ['search'],
      });
      expect(searched?.nodes.map((node) => node.name)).toEqual(['needle note']);

      const createdFolder = await model.createFolder(
        configuration.folderId,
        'Untitled Folder',
      );
      const createdFile = await model.createFile(
        configuration.folderId,
        'Untitled Canvas',
        'mcanvas',
        { locale: 'en' },
      );
      expect(createdFolder.parentId).toBe(configuration.folderId);
      expect(createdFile.node.parentId).toBe(configuration.folderId);
    });
  }

  it('creates canvases using the folder name rule and default template', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 6, 10, 12));
    try {
      const repository = new TestExplorerRepository([
        {
          ...folder('daily', 'daily', null),
          nameRule: { mode: 'custom', pattern: '{weekday} - ' },
          defaultTemplateId: 'tpl',
        },
        { ...folder('sub', 'sub', 'daily'), nameRule: { mode: 'inherit' } },
      ]);
      const templateIds: (VFSNodeId | null)[] = [];
      const model = new ExplorerModel(
        repository,
        (name, parentId, templateId) => {
          templateIds.push(templateId);
          return repository.createFile(name, 'mcanvas', parentId);
        },
      );

      const inFolder = await model.createFile('daily', 'Untitled', 'mcanvas', {
        locale: 'en',
      });
      const inSub = await model.createFile('sub', 'Untitled', 'mcanvas', {
        locale: 'en',
      });
      const blank = await model.createFile('daily', 'Untitled', 'mcanvas', {
        locale: 'en',
        templateId: null,
      });

      expect(inFolder.renameValue).toBe('Wednesday - ');
      expect(inFolder.node.name).toBe('Wednesday');
      expect(inSub.node.name).toBe('Wednesday');
      expect(templateIds).toEqual(['tpl', null, null]);
      expect(blank.renameValue).toBe('Wednesday - ');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a stale refresh after a newer query starts', async () => {
    const repository = new TestExplorerRepository([]);
    const first = deferred<NodeSearchResult[]>();
    const second = deferred<NodeSearchResult[]>();
    const searchNodes = vi
      .spyOn(repository, 'searchNodes')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const model = createModel(repository);

    const firstRefresh = model.refresh({
      folderId: null,
      searchQuery: 'first',
      filterTags: [],
    });
    const secondRefresh = model.refresh({
      folderId: null,
      searchQuery: 'second',
      filterTags: [],
    });

    second.resolve([searchResult(file('second', 'second', null))]);
    await expect(secondRefresh).resolves.toMatchObject({
      nodes: [expect.objectContaining({ id: 'second' })],
    });
    first.resolve([searchResult(file('first', 'first', null))]);
    await expect(firstRefresh).resolves.toBeNull();
    expect(searchNodes).toHaveBeenCalledTimes(2);
  });

  it('sorts folders before files with the requested node order', () => {
    expect(
      sortExplorerNodes(
        [
          file('file', 'A file', null),
          folder('folder-b', 'B folder', null),
          folder('folder-a', 'A folder', null),
        ],
        'name-asc',
      ).map((node) => node.id),
    ).toEqual(['folder-a', 'folder-b', 'file']);
  });
});
