import { describe, expect, it, vi } from 'vitest';
import type { VFSFileNode, VFSFolderNode } from '../../sync/core';
import type { YjsSyncSnapshot } from '../../sync/types';
import { YDocManager } from '../../ydoc-manager';
import { addMarkdownPageFrameToYDoc } from '../markdown/import';
import { getNoteLinkPreview, type NoteLinkPreviewSource } from './preview';

function createFileNode(
  id: string,
  name: string,
  fileType: VFSFileNode['fileType'] = 'mcanvas',
): VFSFileNode {
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

function createFolderNode(id: string, name: string): VFSFolderNode {
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

async function createNoteUpdate(markdown: string): Promise<Uint8Array> {
  const ydoc = new YDocManager();
  await addMarkdownPageFrameToYDoc(ydoc, markdown);
  return ydoc.encodeState();
}

function createSnapshot(update: Uint8Array | null): YjsSyncSnapshot {
  return {
    update,
    stateVector: new Uint8Array(),
    revision: null,
  };
}

describe('getNoteLinkPreview', () => {
  it('loads a linked note preview from its stored page-frame content', async () => {
    const update = await createNoteUpdate(
      '# Alpha Note\n\nPreview paragraph with enough text to display.',
    );
    const repository = {
      getNode: vi.fn(async () => createFileNode('note-1', 'Alpha Note')),
      searchNodes: vi.fn(async () => []),
      getFolderChain: vi.fn(async () => []),
      loadDocument: vi.fn(async () => createSnapshot(update)),
    } satisfies NoteLinkPreviewSource;

    const preview = await getNoteLinkPreview(repository, {
      title: 'Alpha Note',
      noteId: 'note-1',
    });

    expect(preview).toEqual({
      noteId: 'note-1',
      title: 'Alpha Note',
      body: 'Alpha Note\nPreview paragraph with enough text to display.',
    });
    expect(repository.searchNodes).not.toHaveBeenCalled();
    expect(repository.loadDocument).toHaveBeenCalledWith('note-1');
  });

  it('resolves a title-only note link before loading the preview', async () => {
    const update = await createNoteUpdate('Resolved body.');
    const repository = {
      getNode: vi.fn(async () => createFileNode('note-2', 'Resolved Note')),
      searchNodes: vi.fn(async () =>
        [
          createFolderNode('folder-1', 'Folder'),
          createFileNode('note-2', 'Resolved Note'),
        ].map((node) => ({
          node,
          score: 1,
          contentSnippet: null,
          matchedTerms: [],
        })),
      ),
      getFolderChain: vi.fn(async () => []),
      loadDocument: vi.fn(async () => createSnapshot(update)),
    } satisfies NoteLinkPreviewSource;

    const preview = await getNoteLinkPreview(repository, {
      title: 'Resolved Note',
      noteId: null,
    });

    expect(preview?.noteId).toBe('note-2');
    expect(preview?.body).toBe('Resolved body.');
    expect(repository.searchNodes).toHaveBeenCalledWith('Resolved Note');
  });

  it('returns null when the link cannot resolve to a canvas note', async () => {
    const repository = {
      getNode: vi.fn(async () => createFileNode('image-1', 'Image', 'png')),
      searchNodes: vi.fn(async () => []),
      getFolderChain: vi.fn(async () => []),
      loadDocument: vi.fn(async () => createSnapshot(null)),
    } satisfies NoteLinkPreviewSource;

    await expect(
      getNoteLinkPreview(repository, {
        title: 'Missing Note',
        noteId: null,
      }),
    ).resolves.toBeNull();

    expect(repository.getNode).not.toHaveBeenCalled();
    expect(repository.loadDocument).not.toHaveBeenCalled();
  });
});
