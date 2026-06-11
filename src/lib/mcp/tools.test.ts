import { describe, expect, it } from 'vitest';
import { LocalRepository } from '@/lib/sync/repo/local';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { addMarkdownPageFrameToYDoc } from '@/pages/canvas/page-frame/markdown/import';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import { McpToolService } from './tools';

async function createRepositoryWithNote(markdown = '# Original\n\nBody') {
  const repository = new LocalRepository();
  await repository.initialize();
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
