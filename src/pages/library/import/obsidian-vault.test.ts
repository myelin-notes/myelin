import { beforeEach, describe, expect, it } from 'vitest';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { ElementType } from '@myelin/editor/elements/element-type';
import { schema } from '@myelin/editor/page-frame/pm/schema';
import { LocalRepository } from '@/lib/sync/repo/local';
import type { FileType, VFSNodeId } from '@/lib/sync/repo/types';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { importObsidianVault } from './obsidian-vault';

function collectNoteLinks(json: unknown): Array<{
  text: string;
  title: string;
  noteId: VFSNodeId | null;
}> {
  const links: Array<{
    text: string;
    title: string;
    noteId: VFSNodeId | null;
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
          noteId?: VFSNodeId | null;
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
        '---',
        'created_at: 2024-01-30T13:06:58+05:30',
        'modified_at: 2024-02-17T13:20:08+05:30',
        'cssclasses:',
        '  - wide-page',
        'tags:',
        '  - project',
        '  - "#research"',
        '---',
        '',
        'See [[Archive/Beta]], [[Beta]], [[Missing]], and [[Archive/Beta#Heading|Alias]].',
      ].join('\n'),
    );
    await storage.writeTextFile('/vault/Archive/Beta.md', 'Beta note');
    await storage.writeFile('/vault/Projects/image.png', new Uint8Array([7]));
    await storage.writeTextFile('/vault/Ignored/todo.txt', 'skip');
    await storage.writeTextFile('/vault/.obsidian/app.json', '{}');
    await storage.writeFile('/vault/Projects/.cover.png', new Uint8Array([8]));
    await storage.writeTextFile('/vault/.DS_Store', 'skip');
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
    expect(alpha.tags).toEqual(['project', 'research']);
    expect(
      (await repository.listTags()).map((entry) => entry.tag).sort(),
    ).toEqual(['project', 'research']);
    const session = await repository.openSession(alpha.id);
    try {
      const pageFrame = session.ydoc.elements.get(0);
      expect(pageFrame.get('type')).toBe(ElementType.PAGE_FRAME);
      const pageFrameUuid = pageFrame.get('uuid');
      expect(typeof pageFrameUuid).toBe('string');
      const doc = yXmlFragmentToProseMirrorRootNode(
        session.ydoc.getXmlFragment(pageFrameUuid as string),
        schema,
      );
      expect(doc.textContent).toBe(
        'See [[Archive/Beta]], [[Beta]], [[Missing]], and [[Archive/Beta#Heading|Alias]].',
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

  it('imports hierarchical frontmatter tags without persisting ancestors', async () => {
    const storage = getRepositoryTestStorage();
    await storage.writeTextFile(
      '/hier-vault/Note.md',
      ['---', 'tags:', '  - parent/child', '---', '', 'Body'].join('\n'),
    );

    const repository = new LocalRepository('obsidian-hier-import');
    const result = await importObsidianVault({
      repository,
      parentId: null,
      vaultPath: '/hier-vault',
      vaultName: 'HierVault',
    });

    expect(result.notesImported).toBe(1);

    const [, vaultFiles] = await repository.listDirectory(result.rootFolderId);
    const note = vaultFiles.find((file) => file.name === 'Note')!;
    expect(note.tags).toEqual(['parent/child']);

    expect((await repository.listTags()).map((entry) => entry.tag)).toEqual([
      'parent/child',
    ]);
    expect(
      (await repository.listTags(true)).map((entry) => entry.tag).sort(),
    ).toEqual(['parent', 'parent/child']);
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
      ): Promise<VFSNodeId> {
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
