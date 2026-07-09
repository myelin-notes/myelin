import { describe, expect, it } from 'vitest';
import { ElementType } from '@myelin/editor/elements/element-type';
import { addMarkdownPageFrameToYDoc } from '@myelin/editor/page-frame/markdown/import';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { LocalRepository } from '@/lib/sync/repo/local';
import { McpToolService } from './tools';

let repositoryCounter = 0;

async function createEmptyRepository() {
  repositoryCounter += 1;
  const repository = new LocalRepository(
    `repositories/mcp-tools-${repositoryCounter}`,
  );
  await repository.initialize();
  return repository;
}

async function createRepositoryWithNote(markdown = '# Original\n\nBody') {
  const repository = await createEmptyRepository();
  const ydoc = new YDocManager();
  const firstFrameId = await addMarkdownPageFrameToYDoc(ydoc, markdown, {
    displayName: 'First',
  });
  const secondFrameId = await addMarkdownPageFrameToYDoc(ydoc, 'Second body', {
    displayName: 'Second',
    offsetX: 900,
    offsetY: 80,
  });
  const noteId = await repository.createFile(
    'Tool Note',
    'mcanvas',
    null,
    ydoc.encodeState(),
  );
  return { repository, noteId, firstFrameId, secondFrameId };
}

async function createLinkedNotes() {
  const repository = await createEmptyRepository();
  const targetId = await repository.createFile('MCP Target', 'mcanvas', null);
  const ydoc = new YDocManager();
  await addMarkdownPageFrameToYDoc(ydoc, 'See [[MCP Target]] for context.', {
    repository,
  });
  const sourceId = await repository.createFile(
    'MCP Source',
    'mcanvas',
    null,
    ydoc.encodeState(),
  );
  return { repository, sourceId, targetId };
}

describe('MCP tool service', () => {
  it('lists and reads notes through staged tools', async () => {
    const { repository, noteId, firstFrameId } =
      await createRepositoryWithNote();
    const service = new McpToolService({
      repository,
      indexedTextByNode: new Map([[noteId, 'Indexed body']]),
      allowDirectWrites: () => false,
    });

    await expect(service.callTool('list_notes', {})).resolves.toMatchObject({
      notes: [
        {
          id: noteId,
          title: 'Tool Note',
          preview: 'Indexed body',
        },
      ],
    });
    const note = await service.callTool('read_note', { noteId });
    expect(note).toMatchObject({
      indexedText: 'Indexed body',
    });
    expect(
      (note as { elements: Array<{ kind: string; id: string }> }).elements,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'page-frame', id: firstFrameId }),
        expect.objectContaining({ kind: 'page-frame' }),
      ]),
    );
    await expect(
      service.callTool('read_page_frame', {
        noteId,
        pageFrameId: firstFrameId,
      }),
    ).resolves.toMatchObject({
      displayName: 'First',
      plainText: 'Original\nBody',
    });
  });

  it('searches notes, lists recent notes, and lists tags', async () => {
    const repository = await createEmptyRepository();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => true,
    });

    const alpha = (await service.callTool('create_note', {
      title: 'Alpha Knowledge',
      markdown: '# Alpha\n\nBody',
    })) as { note: { id: string } };
    const beta = (await service.callTool('create_note', {
      title: 'Beta Research',
    })) as { note: { id: string } };
    await service.callTool('edit_tags', {
      nodeId: alpha.note.id,
      set: ['knowledge/project'],
    });

    await expect(
      service.callTool('search_notes', {
        query: 'Alpha',
        tag: 'knowledge/project',
      }),
    ).resolves.toMatchObject({
      matches: [
        {
          note: {
            id: alpha.note.id,
            title: 'Alpha Knowledge',
          },
        },
      ],
    });
    await expect(
      service.callTool('list_recent_notes', { limit: 10 }),
    ).resolves.toMatchObject({
      notes: expect.arrayContaining([
        expect.objectContaining({ id: alpha.note.id }),
        expect.objectContaining({ id: beta.note.id }),
      ]),
    });

    const tags = (await service.callTool('list_tags', {
      includeAncestors: true,
    })) as { tags: Array<{ tag: string; count: number }> };
    const tagsByName = new Map(
      tags.tags.map((entry) => [entry.tag, entry.count]),
    );
    expect(tagsByName.get('knowledge')).toBe(1);
    expect(tagsByName.get('knowledge/project')).toBe(1);
  });

  it('applies tag filters before the limit in list_notes', async () => {
    const repository = await createEmptyRepository();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => true,
    });

    await service.callTool('create_note', { title: 'Untagged A' });
    await service.callTool('create_note', { title: 'Untagged B' });
    const tagged = (await service.callTool('create_note', {
      title: 'Tagged',
    })) as { note: { id: string } };
    await service.callTool('edit_tags', {
      nodeId: tagged.note.id,
      set: ['focus'],
    });

    await expect(
      service.callTool('list_notes', { tag: 'focus', limit: 1 }),
    ).resolves.toMatchObject({
      notes: [expect.objectContaining({ id: tagged.note.id })],
    });
  });

  it('scopes list_notes queries to a folder', async () => {
    const repository = await createEmptyRepository();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => true,
    });

    const folder = (await service.callTool('create_folder', {
      name: 'Scoped',
    })) as { id: string };
    const inside = (await service.callTool('create_note', {
      title: 'Match Inside',
      parentId: folder.id,
    })) as { note: { id: string } };
    await service.callTool('create_note', { title: 'Match Outside' });

    await expect(
      service.callTool('list_notes', { query: 'Match', folderId: folder.id }),
    ).resolves.toMatchObject({
      notes: [expect.objectContaining({ id: inside.note.id })],
    });
  });

  it('reads links, backlinks, and renames note references', async () => {
    const { repository, sourceId, targetId } = await createLinkedNotes();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => true,
    });

    await expect(
      service.callTool('read_links', { noteId: sourceId }),
    ).resolves.toMatchObject({
      noteId: sourceId,
      links: [
        {
          targetId,
          targetTitle: 'MCP Target',
          targetName: 'MCP Target',
          targetPath: ['MCP Target'],
          targetExists: true,
          snippet: 'See [[MCP Target]] for context.',
        },
      ],
    });
    await expect(
      service.callTool('read_backlinks', { noteId: targetId }),
    ).resolves.toMatchObject({
      noteId: targetId,
      backlinks: [
        {
          sourceId,
          sourceName: 'MCP Source',
          sourcePath: ['MCP Source'],
          targetId,
          targetTitle: 'MCP Target',
        },
      ],
    });

    await expect(
      service.callTool('rename_node', {
        nodeId: targetId,
        newName: 'Renamed MCP Target',
      }),
    ).resolves.toMatchObject({
      node: {
        id: targetId,
        name: 'Renamed MCP Target',
      },
      referenceUpdates: {
        sourceCount: 1,
        linkCount: 1,
      },
    });
    await expect(
      service.callTool('read_links', { noteId: sourceId }),
    ).resolves.toMatchObject({
      links: [
        {
          targetId,
          targetTitle: 'Renamed MCP Target',
          targetName: 'Renamed MCP Target',
        },
      ],
    });
  });

  it('blocks write tools unless direct writes are allowed', async () => {
    const { repository, noteId } = await createRepositoryWithNote();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => false,
    });

    await expect(
      service.callTool('create_page_frame', {
        noteId,
        markdown: '# Blocked',
      }),
    ).rejects.toThrow('Direct MCP writes are disabled');
  });

  it('creates a page frame with parsed markdown', async () => {
    const { repository, noteId } = await createRepositoryWithNote();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => true,
    });

    const result = await service.callTool('create_page_frame', {
      noteId,
      markdown: '# Added\n\nNew body',
      displayName: 'Added',
    });

    expect(result).toMatchObject({
      noteId,
      displayName: 'Added',
    });

    const note = await service.callTool('read_note', { noteId });
    expect(
      (note as { elements: Array<{ kind: string }> }).elements.filter(
        (element) => element.kind === 'page-frame',
      ),
    ).toHaveLength(3);
    expect(
      await service.callTool('read_page_frame', {
        noteId,
        pageFrameId: (result as { pageFrameId: string }).pageFrameId,
      }),
    ).toMatchObject({
      plainText: 'Added\nNew body',
    });
  });

  it('creates folders and notes and lists directories', async () => {
    const repository = await createEmptyRepository();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => true,
    });

    const folder = (await service.callTool('create_folder', {
      name: 'Projects',
    })) as { id: string };
    const note = (await service.callTool('create_note', {
      title: 'MCP Created',
      parentId: folder.id,
      markdown: '# Created\n\nBody',
    })) as {
      note: { id: string; title: string; path: string[] };
      elements: Array<{ kind: string }>;
    };

    expect(note).toMatchObject({
      note: {
        title: 'MCP Created',
        path: ['Projects', 'MCP Created'],
      },
    });
    expect(note.elements).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'page-frame' })]),
    );

    const rootListing = (await service.callTool('list_directory', {})) as {
      folders: Array<{ id: string; name: string; type: string }>;
    };
    expect(rootListing.folders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: folder.id,
          name: 'Projects',
          type: 'folder',
        }),
      ]),
    );
    await expect(
      service.callTool('list_directory', { folderId: folder.id }),
    ).resolves.toMatchObject({
      folder: expect.objectContaining({ id: folder.id }),
      files: [
        expect.objectContaining({
          id: note.note.id,
          name: 'MCP Created',
          type: 'file',
          fileType: 'mcanvas',
        }),
      ],
    });
  });

  it('moves nodes and edits tags', async () => {
    const repository = await createEmptyRepository();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => true,
    });

    const source = (await service.callTool('create_folder', {
      name: 'Source',
    })) as { id: string };
    const destination = (await service.callTool('create_folder', {
      name: 'Destination',
    })) as { id: string };
    const note = (await service.callTool('create_note', {
      title: 'Move Me',
      parentId: source.id,
    })) as { note: { id: string } };

    await expect(
      service.callTool('move_node', {
        nodeId: note.note.id,
        newParentId: destination.id,
      }),
    ).resolves.toMatchObject({
      id: note.note.id,
      parentId: destination.id,
      path: ['Destination', 'Move Me'],
    });

    await expect(
      service.callTool('edit_tags', {
        nodeId: note.note.id,
        set: ['alpha', ' alpha ', ''],
        add: ['beta'],
        remove: ['alpha'],
      }),
    ).resolves.toMatchObject({
      id: note.note.id,
      tags: ['beta'],
    });
    await expect(
      service.callTool('edit_tags', { nodeId: note.note.id }),
    ).rejects.toThrow('edit_tags requires set, add, or remove');
  });

  it('guards destructive deletes', async () => {
    const repository = await createEmptyRepository();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => true,
    });

    const folder = (await service.callTool('create_folder', {
      name: 'Delete Me',
    })) as { id: string };
    const note = (await service.callTool('create_note', {
      title: 'Nested Note',
      parentId: folder.id,
    })) as { note: { id: string } };

    await expect(
      service.callTool('delete_node', {
        nodeId: note.note.id,
        confirm: false,
      }),
    ).rejects.toThrow('delete_node requires confirm=true');
    await expect(
      service.callTool('delete_node', {
        nodeId: folder.id,
        confirm: true,
      }),
    ).rejects.toThrow(
      'delete_node requires recursive=true to delete a non-empty folder',
    );

    await expect(
      service.callTool('delete_node', {
        nodeId: folder.id,
        confirm: true,
        recursive: true,
      }),
    ).resolves.toMatchObject({
      deleted: expect.objectContaining({
        id: folder.id,
        type: 'folder',
      }),
    });
    await expect(repository.getNode(folder.id)).resolves.toBeNull();
    await expect(repository.getNode(note.note.id)).resolves.toBeNull();
  });

  it('replaces only the target page frame', async () => {
    const { repository, noteId, firstFrameId, secondFrameId } =
      await createRepositoryWithNote();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => true,
    });

    await service.callTool('replace_page_frame_markdown', {
      noteId,
      pageFrameId: firstFrameId,
      markdown: '# Replacement',
    });

    await expect(
      service.callTool('read_page_frame', {
        noteId,
        pageFrameId: firstFrameId,
      }),
    ).resolves.toMatchObject({
      plainText: 'Replacement',
    });
    await expect(
      service.callTool('read_page_frame', {
        noteId,
        pageFrameId: secondFrameId,
      }),
    ).resolves.toMatchObject({
      plainText: 'Second body',
    });
  });

  it('clears a page frame with empty markdown', async () => {
    const { repository, noteId, firstFrameId } =
      await createRepositoryWithNote();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => true,
    });

    await service.callTool('replace_page_frame_markdown', {
      noteId,
      pageFrameId: firstFrameId,
      markdown: '',
    });

    await expect(
      service.callTool('read_page_frame', {
        noteId,
        pageFrameId: firstFrameId,
      }),
    ).resolves.toMatchObject({
      plainText: '',
    });
  });

  it('deletes page frames only with confirmation', async () => {
    const { repository, noteId, firstFrameId } =
      await createRepositoryWithNote();
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => true,
    });

    await expect(
      service.callTool('delete_page_frame', {
        noteId,
        pageFrameId: firstFrameId,
        confirm: false,
      }),
    ).rejects.toThrow('delete_page_frame requires confirm=true');

    await expect(
      service.callTool('delete_page_frame', {
        noteId,
        pageFrameId: firstFrameId,
        confirm: true,
      }),
    ).resolves.toMatchObject({
      deleted: {
        noteId,
        pageFrameId: firstFrameId,
        plainText: 'Original\nBody',
      },
    });

    const note = await service.callTool('read_note', { noteId });
    expect(
      (note as { elements: Array<{ kind: string; id: string }> }).elements,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'page-frame', id: firstFrameId }),
      ]),
    );
    await expect(
      service.callTool('read_page_frame', {
        noteId,
        pageFrameId: firstFrameId,
      }),
    ).rejects.toThrow('Element not found');
  });

  it('exposes non-page-frame readers', async () => {
    const { repository, noteId } = await createRepositoryWithNote();
    const session = await repository.openSession(noteId);
    session.ydoc.createElementMap(ElementType.LATEX, 'latex-1', {
      latex: 'x^2',
    });
    await session.save();
    await session.close();

    const service = new McpToolService({
      repository,
      allowDirectWrites: () => false,
    });

    await expect(
      service.callTool('read_latex', { noteId, elementId: 'latex-1' }),
    ).resolves.toMatchObject({
      latex: 'x^2',
    });
  });
});
