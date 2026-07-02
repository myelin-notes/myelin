import { beforeEach, describe, expect, it, vi } from 'vitest';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { serializeDocToMarkdown } from '@/pages/canvas/page-frame/markdown/serializer';
import { schema } from '@/pages/canvas/page-frame/pm/schema';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import {
  createCanvasNoteState,
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
  getNoteGraph,
  getStoredFileName,
  MANIFEST_PATH,
} from './shared';

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

    const uuid = yMap.get('uuid');
    if (typeof uuid !== 'string') {
      continue;
    }

    return serializeDocToMarkdown(
      yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(uuid), schema),
    );
  }

  return '';
}

describe('LocalRepository', () => {
  beforeEach(() => {
    vi.useRealTimers();
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
    expect(result.changed).toBe(true);

    const reopened = new LocalRepository('repositories/local-test');
    await reopened.initialize();

    const [folders, files] = await reopened.listDirectory(folderId);
    expect(folders).toHaveLength(0);
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe(fileId);

    const snapshot = await reopened.loadDocument(fileId);
    expect(readNoteText(snapshot.update)).toBe('hello local repository');
  });

  it('registers ancestor tags when a nested tag is added', async () => {
    const repository = new LocalRepository('repositories/registry-ancestors');
    await repository.initialize();

    await repository.addRegistryTags(['uni/math/calc']);

    expect((await repository.getRegistryTags()).sort()).toEqual([
      'uni',
      'uni/math',
      'uni/math/calc',
    ]);
  });

  it('backfills registry fields when loading a pre-tagRegistry manifest', async () => {
    const storage = getRepositoryTestStorage();
    const manifestPath = `repositories/legacy-manifest/${MANIFEST_PATH}`;
    // A manifest written before `tagRegistry`/`customColors` existed.
    await storage.writeTextFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        children: [],
        nodes: {},
        linksBySource: {},
      }),
    );

    const repository = new LocalRepository('repositories/legacy-manifest');
    await repository.initialize();

    expect(await repository.getRegistryTags()).toEqual([]);
    expect(await repository.getCustomColors()).toEqual([]);
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

  it('does not touch notes when pushed updates make no document changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const repository = new LocalRepository('repositories/noop-push-test');
    await repository.initialize();

    const fileId = await repository.createFile('Stable', 'mcanvas', null);
    const note = createNoteState('stable content');
    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const snapshot = await repository.loadDocument(fileId);
    const modifiedAt = (await repository.getNode(fileId))?.modifiedAt;
    const noOpUpdate = (
      await repository.pullUpdates(fileId, snapshot.stateVector)
    ).update;

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));

    const result = await repository.pushUpdates(
      fileId,
      noOpUpdate ?? new Uint8Array(),
      {
        baseRevision: snapshot.revision,
        localStateVector: snapshot.stateVector,
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.revision).toBe(snapshot.revision);
    expect((await repository.getNode(fileId))?.modifiedAt).toBe(modifiedAt);
    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'stable content',
    );
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
        pageFrameId: null,
        title: 'Target',
        snippet: 'See [[Target]] for context.',
      },
    ]);

    await repository.deleteNode(sourceId);

    expect(await repository.getBacklinks(targetId)).toEqual([]);
  });

  it('returns a note graph projection for non-system canvas notes', async () => {
    const repository = new LocalRepository('repositories/note-graph-test');
    await repository.initialize();

    const sourceId = await repository.createFile('Source', 'mcanvas', null);
    const targetId = await repository.createFile('Target', 'mcanvas', null);
    const otherId = await repository.createFile('Other', 'mcanvas', null);
    await repository.createFile('Image', 'png', null, new Uint8Array([1]));

    const note = await createCanvasNoteState(
      'See [[Target]], [[Target]], and [[Missing]].',
      async (title) => (title === 'Target' ? targetId : null),
    );

    await repository.pushUpdates(sourceId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    expect(await repository.getNoteGraph()).toEqual({
      nodes: [
        { id: sourceId, name: 'Source', tags: [] },
        { id: targetId, name: 'Target', tags: [] },
        { id: otherId, name: 'Other', tags: [] },
      ],
      links: [
        {
          sourceId,
          targetId,
          pageFrameId: null,
          title: 'Target',
          snippet: 'See [[Target]], [[Target]], and [[Missing]].',
        },
        {
          sourceId,
          targetId,
          pageFrameId: null,
          title: 'Target',
          snippet: 'See [[Target]], [[Target]], and [[Missing]].',
        },
        {
          sourceId,
          targetId: null,
          pageFrameId: null,
          title: 'Missing',
          snippet: 'See [[Target]], [[Target]], and [[Missing]].',
        },
      ],
    });
  });

  it('excludes system canvas files from the note graph projection', () => {
    const manifest = createEmptyManifest();
    const userId = 'user-note';
    const systemId = 'system-note';
    const now = Date.now();

    manifest.nodes[userId] = createFileNode(
      userId,
      'User Note',
      'mcanvas',
      null,
      now,
    );
    manifest.nodes[systemId] = createFileNode(
      systemId,
      'System Note',
      'mcanvas',
      null,
      now,
      {
        kind: 'file-version',
        sourceFileId: userId,
        sourceFileType: 'mcanvas',
        sourceName: 'User Note',
        sourceRevision: 'rev',
        capturedAt: now,
        byteLength: 10,
      },
    );
    manifest.children.push(userId, systemId);
    manifest.linksBySource[userId] = [
      {
        targetId: systemId,
        pageFrameId: null,
        title: 'System Note',
        snippet: 'Old snapshot',
      },
    ];

    expect(getNoteGraph(manifest)).toEqual({
      nodes: [{ id: userId, name: 'User Note', tags: [] }],
      links: [
        {
          sourceId: userId,
          targetId: systemId,
          pageFrameId: null,
          title: 'System Note',
          snippet: 'Old snapshot',
        },
      ],
    });
  });

  it('renames note references from backlink sources', async () => {
    const repository = new LocalRepository(
      'repositories/reference-rename-test',
    );
    await repository.initialize();

    const sourceId = await repository.createFile('Source', 'mcanvas', null);
    const targetId = await repository.createFile('Target', 'mcanvas', null);
    const note = await createCanvasNoteState(
      'See [[Target]] and [[Projects/Target#Frame]].',
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
    ).toBe('See [[Renamed Target]] and [[Projects/Renamed Target#Frame]].\n');
    expect(
      (await repository.getBacklinks(targetId)).map((link) => link.title),
    ).toEqual(['Renamed Target', 'Projects/Renamed Target#Frame']);
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
