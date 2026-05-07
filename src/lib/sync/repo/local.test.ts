import { beforeEach, describe, expect, it } from 'vitest';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { addMarkdownPageFrameToYDoc } from '@/pages/canvas/page-frame/markdown-import';
import { serializeDocToMarkdown } from '@/pages/canvas/page-frame/markdown-serializer';
import { schema } from '@/pages/canvas/page-frame/pm/schema';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import {
  createNoteState,
  getRepositoryTestStorage,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { LocalRepository } from './local';
import { renameNoteReferences } from './rename-note-references';
import {
  createEmptyManifest,
  createFileNode,
  getNoteFileName,
  getStoredFileName,
  MANIFEST_PATH,
} from './shared';
import type { FileId } from './types';

async function createCanvasNoteState(
  markdown: string,
  resolveNoteLinkId?: (title: string) => Promise<FileId | null>,
): Promise<{
  update: Uint8Array;
  stateVector: Uint8Array;
}> {
  const ydoc = new YDocManager();
  await addMarkdownPageFrameToYDoc(ydoc, markdown, { resolveNoteLinkId });
  return {
    update: ydoc.encodeState(),
    stateVector: ydoc.encodeStateVector(),
  };
}

function readFirstPageFrameMarkdown(update: Uint8Array | null): string {
  if (!update || update.byteLength === 0) {
    return '';
  }

  const ydoc = YDocManager.fromUpdate(update);
  for (let i = 0; i < ydoc.elements.length; i++) {
    const yMap = ydoc.elements.get(i);
    if (yMap.get('type') !== ElementType.PAGE_FRAME) {
      continue;
    }

    const index = yMap.get('index');
    if (typeof index !== 'number') {
      continue;
    }

    return serializeDocToMarkdown(
      yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(index), schema),
    );
  }

  return '';
}

describe('LocalRepository', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
  });

  it('persists manifest and note data across instances', async () => {
    const repository = new LocalRepository('repositories/local-test');
    await repository.initialize();

    const folderId = await repository.createFolder('Docs', null);
    const fileId = await repository.createFile('Note', 'mcanvas', folderId);
    const note = createNoteState('hello local repository');

    const result = await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    expect(result.accepted).toBe(true);

    const reopened = new LocalRepository('repositories/local-test');
    await reopened.initialize();

    const [folders, files] = await reopened.listDirectory(folderId);
    expect(folders).toHaveLength(0);
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe(fileId);

    const snapshot = await reopened.loadDocument(fileId);
    expect(readNoteText(snapshot.update)).toBe('hello local repository');
  });

  it('returns reveal paths inside app data storage', async () => {
    const repository = new LocalRepository('repositories/reveal-test');
    await repository.initialize();

    const fileId = await repository.createFile('Reveal', 'mcanvas', null);
    const revealPath = await repository.getRevealPath(fileId);

    expect(revealPath).toBe(
      `/app-data/repositories/reveal-test/files/${getNoteFileName(fileId)}`,
    );
  });

  it('writes note files into storage-backed paths', async () => {
    const repository = new LocalRepository('repositories/file-test');
    await repository.initialize();

    const fileId = await repository.createFile('Saved', 'mcanvas', null);
    const note = createNoteState('persisted bytes');

    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const storage = getRepositoryTestStorage();
    const storedBytes = storage.readBinary(
      `repositories/file-test/files/${getNoteFileName(fileId)}`,
    );

    expect(storedBytes).not.toBeNull();
    expect(readNoteText(storedBytes)).toBe('persisted bytes');
  });

  it('stores outgoing note links and returns backlinks', async () => {
    const repository = new LocalRepository('repositories/backlink-test');
    await repository.initialize();

    const sourceId = await repository.createFile('Source', 'mcanvas', null);
    const targetId = await repository.createFile('Target', 'mcanvas', null);
    const note = await createCanvasNoteState(
      'See [[Target]] for context.',
      async (title) => (title === 'Target' ? targetId : null),
    );

    await repository.pushUpdates(sourceId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    expect(await repository.getBacklinks(targetId)).toEqual([
      {
        sourceId,
        sourceName: 'Source',
        targetId,
        title: 'Target',
        snippet: 'See [[Target]] for context.',
      },
    ]);

    await repository.deleteNode(sourceId);

    expect(await repository.getBacklinks(targetId)).toEqual([]);
  });

  it('renames note references from backlink sources', async () => {
    const repository = new LocalRepository(
      'repositories/reference-rename-test',
    );
    await repository.initialize();

    const sourceId = await repository.createFile('Source', 'mcanvas', null);
    const targetId = await repository.createFile('Target', 'mcanvas', null);
    const note = await createCanvasNoteState(
      'See [[Target]] and [[Projects/Target#Frame|alias]].',
      async (title) => (title.includes('Target') ? targetId : null),
    );

    await repository.pushUpdates(sourceId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const backlinks = await repository.getBacklinks(targetId);
    await repository.renameNode(targetId, 'Renamed Target');

    await expect(
      renameNoteReferences(repository, targetId, 'Renamed Target', backlinks),
    ).resolves.toEqual({ sourceCount: 1, linkCount: 2 });

    expect(
      readFirstPageFrameMarkdown(await repository.readFileBytes(sourceId)),
    ).toBe(
      'See [[Renamed Target]] and [[Projects/Renamed Target#Frame|alias]].\n',
    );
    expect(
      (await repository.getBacklinks(targetId)).map((link) => link.title),
    ).toEqual(['Renamed Target', 'Projects/Renamed Target#Frame|alias']);
  });

  it('stores image files as regular VFS file nodes', async () => {
    const repository = new LocalRepository('repositories/image-file-test');
    await repository.initialize();

    const bytes = new Uint8Array([137, 80, 78, 71]);
    const fileId = await repository.createFile('Photo.png', 'png', null, bytes);

    const node = await repository.getNode(fileId);
    expect(node).toMatchObject({
      id: fileId,
      name: 'Photo.png',
      type: 'file',
      fileType: 'png',
    });

    const storage = getRepositoryTestStorage();
    const storedName = getStoredFileName({ id: fileId, fileType: 'png' });
    const storedPath = `repositories/image-file-test/files/${storedName}`;
    const storedBytes = storage.readBinary(storedPath);

    expect(Array.from(storedBytes ?? [])).toEqual(Array.from(bytes));
    expect(Array.from((await repository.readFileBytes(fileId)) ?? [])).toEqual(
      Array.from(bytes),
    );
    expect(await repository.getRevealPath(fileId)).toBe(
      `/app-data/repositories/image-file-test/files/${fileId}.png`,
    );

    await repository.deleteNode(fileId);

    expect(storage.readBinary(storedPath)).toBeNull();
  });

  it('removes stored note bytes when a file is deleted', async () => {
    const repository = new LocalRepository('repositories/delete-test');
    await repository.initialize();

    const fileId = await repository.createFile('Trash', 'mcanvas', null);
    const note = createNoteState('delete me');

    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const storage = getRepositoryTestStorage();
    const filePath = `repositories/delete-test/files/${getNoteFileName(fileId)}`;
    expect(storage.readBinary(filePath)).not.toBeNull();

    await repository.deleteNode(fileId);

    expect(storage.readBinary(filePath)).toBeNull();
    expect(await repository.getNode(fileId)).toBeNull();
  });

  it('recreates empty note files from snapshots without loading stale bytes', async () => {
    const repository = new LocalRepository('repositories/replace-test');
    const fileId = 'file-empty';
    const manifest = createEmptyManifest();
    manifest.children.push(fileId);
    manifest.nodes[fileId] = createFileNode(
      fileId,
      'Empty',
      'mcanvas',
      null,
      Date.now(),
    );

    await repository.replaceSnapshot({
      manifest,
      notes: {
        [fileId]: null,
      },
    });

    const storage = getRepositoryTestStorage();
    const storedBytes = storage.readBinary(
      `repositories/replace-test/files/${getNoteFileName(fileId)}`,
    );

    expect(storedBytes).not.toBeNull();
    expect(storedBytes).toHaveLength(0);

    const snapshot = await repository.loadDocument(fileId);
    expect(snapshot.update).toBeNull();
    expect(snapshot.revision).toBeNull();
  });

  it('reloads the manifest from disk after refresh', async () => {
    const repository = new LocalRepository('repositories/refresh-test');
    await repository.initialize();

    const folderId = await repository.createFolder('Docs', null);
    const storage = getRepositoryTestStorage();
    const manifestPath = `repositories/refresh-test/${MANIFEST_PATH}`;
    const manifest = JSON.parse(storage.readText(manifestPath) ?? '{}') as {
      nodes: Record<string, { name: string }>;
    };

    manifest.nodes[folderId].name = 'Renamed Outside Repository';
    await storage.writeTextFile(manifestPath, JSON.stringify(manifest));

    expect((await repository.getNode(folderId))?.name).toBe('Docs');

    await repository.refresh();

    expect((await repository.getNode(folderId))?.name).toBe(
      'Renamed Outside Repository',
    );
  });
});
