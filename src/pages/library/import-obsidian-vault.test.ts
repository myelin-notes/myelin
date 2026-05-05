import { beforeEach, describe, expect, it } from 'vitest';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { LocalRepository } from '@/lib/sync/repo/local';
import type { FileId, FileType } from '@/lib/sync/repo/types';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { schema } from '@/pages/canvas/page-frame/pm/schema';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { importObsidianVault } from './import-obsidian-vault';

function collectNoteLinks(json: unknown): Array<{
  text: string;
  title: string;
  noteId: FileId | null;
}> {
  const links: Array<{
    text: string;
    title: string;
    noteId: FileId | null;
  }> = [];

  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }

    const candidate = node as {
      text?: string;
      marks?: Array<{
        type?: string;
        attrs?: {
          title?: string;
          noteId?: FileId | null;
        };
      }>;
      content?: unknown[];
    };
    const noteLink = candidate.marks?.find((mark) => mark.type === 'noteLink');
    if (noteLink?.attrs && candidate.text) {
      links.push({
        text: candidate.text,
        title: noteLink.attrs.title ?? '',
        noteId: noteLink.attrs.noteId ?? null,
      });
    }

    for (const child of candidate.content ?? []) {
      visit(child);
    }
  };

  visit(json);
  return links;
}

describe('Obsidian vault import', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
  });

  it('imports supported vault files into a preserved folder tree', async () => {
    const storage = getRepositoryTestStorage();
    await storage.writeTextFile(
      '/vault/Projects/Alpha.md',
      [
        'See [[Archive/Beta]], [[Beta]], [[Missing]], and [[Archive/Beta#Heading|Alias]].',
      ].join('\n'),
    );
    await storage.writeTextFile('/vault/Archive/Beta.md', 'Beta note');
    await storage.writeFile('/vault/Projects/image.png', new Uint8Array([7]));
    await storage.writeTextFile('/vault/Ignored/todo.txt', 'skip');
    await storage.writeTextFile('/vault/.obsidian/app.json', '{}');
    storage.writeSymlink('/vault/Projects/link.md');

    const repository = new LocalRepository('obsidian-import');
    const result = await importObsidianVault({
      repository,
      parentId: null,
      vaultPath: '/vault',
      vaultName: 'Vault',
    });

    expect(result.notesImported).toBe(2);
    expect(result.mediaImported).toBe(1);
    expect(result.skippedFiles).toBe(2);

    const [rootFolders] = await repository.listDirectory(null);
    expect(rootFolders.map((folder) => folder.name)).toEqual(['Vault']);
    expect(rootFolders[0].id).toBe(result.rootFolderId);

    const [vaultFolders, vaultFiles] = await repository.listDirectory(
      result.rootFolderId,
    );
    expect(vaultFiles).toEqual([]);
    expect(vaultFolders.map((folder) => folder.name).sort()).toEqual([
      'Archive',
      'Projects',
    ]);

    const archiveFolder = vaultFolders.find(
      (folder) => folder.name === 'Archive',
    )!;
    const projectsFolder = vaultFolders.find(
      (folder) => folder.name === 'Projects',
    )!;
    const [, archiveFiles] = await repository.listDirectory(archiveFolder.id);
    const [, projectFiles] = await repository.listDirectory(projectsFolder.id);

    expect(archiveFiles.map((file) => file.name)).toEqual(['Beta']);
    expect(projectFiles.map((file) => file.name).sort()).toEqual([
      'Alpha',
      'image.png',
    ]);
    expect(
      projectFiles.find((file) => file.name === 'image.png')?.fileType,
    ).toBe('png');

    const alpha = projectFiles.find((file) => file.name === 'Alpha')!;
    const beta = archiveFiles.find((file) => file.name === 'Beta')!;
    const session = await repository.openSession(alpha.id);
    try {
      const pageFrame = session.ydoc.elements.get(0);
      expect(pageFrame.get('type')).toBe(ElementType.PAGE_FRAME);
      const doc = yXmlFragmentToProseMirrorRootNode(
        session.ydoc.getXmlFragment(0),
        schema,
      );
      expect(collectNoteLinks(doc.toJSON())).toEqual([
        {
          text: '[[Archive/Beta]]',
          title: 'Archive/Beta',
          noteId: beta.id,
        },
        {
          text: '[[Beta]]',
          title: 'Beta',
          noteId: beta.id,
        },
        {
          text: '[[Missing]]',
          title: 'Missing',
          noteId: null,
        },
        {
          text: '[[Archive/Beta#Heading|Alias]]',
          title: 'Archive/Beta#Heading|Alias',
          noteId: beta.id,
        },
      ]);
    } finally {
      await session.close();
    }
  });

  it('removes the imported root folder when a fatal import error occurs', async () => {
    const storage = getRepositoryTestStorage();
    await storage.writeTextFile('/vault/Broken.md', 'Broken');

    const error = new Error('create failed');
    class FailingRepository extends LocalRepository {
      override async createFile(
        name: string,
        fileType: FileType,
        parentId: string | null,
        bytes?: Uint8Array,
      ): Promise<FileId> {
        if (name === 'Broken') {
          throw error;
        }
        return super.createFile(name, fileType, parentId, bytes);
      }
    }

    const repository = new FailingRepository('obsidian-failed-import');
    await expect(
      importObsidianVault({
        repository,
        parentId: null,
        vaultPath: '/vault',
        vaultName: 'Vault',
      }),
    ).rejects.toThrow(error);

    const [rootFolders, rootFiles] = await repository.listDirectory(null);
    expect(rootFolders).toEqual([]);
    expect(rootFiles).toEqual([]);
  });
});
