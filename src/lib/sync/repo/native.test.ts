import { beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import en from '@myelin/editor/i18n/messages/en';
import { invoke } from '@tauri-apps/api/core';
import { createCanvasFile } from '@/pages/library/import/canvas-file';
import { filesProvider } from '@/pages/library/import/providers/files';
import type { NativeDocumentChange } from '../native-document-target';
import { NativeRepository } from './native';
import { renameNoteReferences } from './rename-note-references';
import { renamePageFrameReferences } from './rename-page-frame-references';
import { createRepositoryFromConfig } from './repository-backends';
import { createEmptyManifest, type VFSManifest } from './shared';

const { listeners } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(() => {
    throw new Error('Raw imports must be read by Rust');
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      listeners.set(name, handler);
      return () => {
        listeners.delete(name);
      };
    },
  ),
}));
vi.mock('./github/credentials', () => ({
  getGitHubToken: async () => 'token',
  hasGitHubToken: async () => true,
}));

beforeEach(() => {
  listeners.clear();
  vi.mocked(invoke).mockReset();
});

function nativeBoundary() {
  let manifest = createEmptyManifest();
  let version = 0;
  const files = new Map<string, Uint8Array>();
  const operations: Record<string, unknown>[] = [];
  const transfers = new Map<string, number[]>();
  const documents = new Map<string, Y.Doc>();
  const status = () => ({
    repositoryId: 'local',
    online: true,
    pendingRemoteWrites: 0,
    lastRemoteSyncAt: null,
    lastError: null,
    dataVersion: version,
  });
  let competingEdit = false;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'repository_open') {
      return { handle: 'native-handle', status: status() };
    }
    if (command === 'repository_release' || command === 'repository_sync') {
      return;
    }
    if (command !== 'repository_operation') {
      throw new Error(`Unexpected command ${command}`);
    }
    let op = (args as { operation: Record<string, unknown> }).operation;
    operations.push(op);
    if (op.kind === 'stage-bytes') {
      const bytes = transfers.get(op.transferId as string) ?? [];
      expect(bytes.length).toBe(op.offset);
      bytes.push(...Buffer.from(op.bytesBase64 as string, 'base64'));
      transfers.set(op.transferId as string, bytes);
      return;
    }
    if (op.kind === 'cancel-transfer') {
      transfers.delete(op.transferId as string);
      return;
    }
    if (op.kind === 'finish-transfer') {
      const bytes = Buffer.from(transfers.get(op.transferId as string)!);
      transfers.delete(op.transferId as string);
      const operation = op.operation as Record<string, unknown>;
      const field =
        operation.kind === 'update-document' ? 'updateBase64' : 'bytesBase64';
      op = { ...operation, [field]: bytes.toString('base64') };
    }
    switch (op.kind) {
      case 'manifest':
        return {
          manifest: structuredClone(manifest),
          revision: String(version),
        };
      case 'save-manifest': {
        if (competingEdit) {
          competingEdit = false;
          manifest.colors.pen = ['#123456'];
          manifest.linksBySource.concurrent = [
            {
              targetId: 'target',
              pageFrameId: null,
              title: 'Target',
              snippet: 'Concurrent link',
            },
          ];
          version++;
        }
        if (op.revision !== String(version)) {
          throw new Error('Native manifest conflict');
        }
        manifest = structuredClone(op.manifest as VFSManifest);
        version++;
        listeners.get('repository-status')?.({ payload: status() });
        return { revision: String(version) };
      }
      case 'write-file': {
        const node = op.node as { id: string };
        files.set(
          node.id,
          Uint8Array.from(Buffer.from(op.bytesBase64 as string, 'base64')),
        );
        return { revision: 'file-revision' };
      }
      case 'read-file': {
        const bytes = files.get(op.nodeId as string) ?? new Uint8Array();
        return {
          bytesBase64: Buffer.from(bytes).toString('base64'),
          revision: 'file-revision',
        };
      }
      case 'document': {
        const doc = documents.get(op.nodeId as string) ?? new Y.Doc();
        documents.set(op.nodeId as string, doc);
        return {
          updateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString(
            'base64',
          ),
          stateVectorBase64: Buffer.from(Y.encodeStateVector(doc)).toString(
            'base64',
          ),
          revision: 'doc-revision',
          generation: 'original',
        };
      }
      case 'update-document': {
        const doc = documents.get(op.nodeId as string)!;
        Y.applyUpdate(doc, Buffer.from(op.updateBase64 as string, 'base64'));
        return {
          stateVectorBase64: Buffer.from(Y.encodeStateVector(doc)).toString(
            'base64',
          ),
          revision: 'doc-revision',
          accepted: true,
          changed: true,
        };
      }
      case 'subscribe':
      case 'unsubscribe':
      case 'checkpoint-document':
      case 'path':
        return null;
      default:
        throw new Error(`Unexpected operation ${String(op.kind)}`);
    }
  });
  return {
    files,
    documents,
    operations,
    manifest: () => manifest,
    compete: () => {
      competingEdit = true;
    },
    status,
  };
}

it('uses native factories, imports bytes before publishing a batch, and replays metadata conflicts', async () => {
  const native = nativeBoundary();
  const repository = createRepositoryFromConfig({ kind: 'local' });
  expect(repository).toBeInstanceOf(NativeRepository);
  await repository.initialize();
  let fileId = '';
  await repository.batchManifestWrites(async () => {
    const folder = await repository.createFolder('Imported', null);
    fileId = await repository.createFile(
      'Image',
      'png',
      folder,
      new Uint8Array([1, 2, 3]),
    );
    expect(native.manifest().nodes[fileId]).toBeUndefined();
    expect(native.files.get(fileId)).toEqual(new Uint8Array([1, 2, 3]));
  });
  expect(native.manifest().nodes[fileId]?.name).toBe('Image');
  native.compete();
  await repository.renameNode(fileId, 'Renamed');
  expect(native.manifest().nodes[fileId]?.name).toBe('Renamed');
  expect(native.manifest().colors.pen).toEqual(['#123456']);
  expect(native.manifest().linksBySource.concurrent[0]?.title).toBe('Target');
  const before = repository.getRuntimeStatus().dataVersion;
  listeners.get('repository-status')?.({
    payload: {
      ...native.status(),
      dataVersion: native.status().dataVersion + 1,
    },
  });
  expect(repository.getRuntimeStatus().dataVersion).toBeGreaterThan(before);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.every(([command]) => command.startsWith('repository_')),
  ).toBe(true);
  await repository.dispose();
  expect(listeners.size).toBe(0);
});

it('keeps snapshot and restore content in Rust while ordinary writes check conflicts', async () => {
  const native = nativeBoundary();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  const version = {
    id: 'version',
    sourceFileId: 'image',
    sourceName: 'Image',
    fileType: 'png',
    sourceRevision: 'old',
    capturedAt: 1,
    byteLength: 2,
  };
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'repository_operation') {
      const op = (args as { operation: Record<string, unknown> }).operation;
      if (
        op.kind === 'create-file-version' ||
        op.kind === 'restore-file-version'
      ) {
        native.operations.push(op);
        return op.kind === 'create-file-version' ? version : null;
      }
    }
    return implementation(command, args);
  });
  const repository = new NativeRepository({ kind: 'local' });
  await repository.initialize();
  const id = await repository.createFile(
    'Image',
    'png',
    null,
    new Uint8Array([1, 2]),
  );
  await repository.writeFileBytes(id, new Uint8Array([2, 3]));
  expect(native.operations.at(-1)).toMatchObject({
    kind: 'write-file',
    overwriteRemote: false,
  });
  const before = native.operations.length;
  expect(await repository.createFileVersionIfDue(id)).toEqual(version);
  await repository.createFileVersionIfDue(id, { force: true });
  await repository.restoreFileVersion(id, 'version');
  expect(native.operations.slice(before)).toEqual([
    { kind: 'create-file-version', nodeId: id, force: false },
    { kind: 'create-file-version', nodeId: id, force: true },
    { kind: 'restore-file-version', nodeId: id, versionId: 'version' },
  ]);
  await repository.dispose();
});

it('does not publish a new file while its native byte write is still in flight', async () => {
  const native = nativeBoundary();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  let release!: () => void;
  let entered!: () => void;
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (
      command === 'repository_operation' &&
      (args as { operation: { kind: string } }).operation.kind === 'write-file'
    ) {
      entered();
      await gate;
    }
    return implementation(command, args);
  });
  const repository = new NativeRepository({ kind: 'local' });
  const creating = repository.createFile(
    'Large import',
    'png',
    null,
    new Uint8Array([4, 5, 6]),
  );
  await writing;
  try {
    expect(Object.keys(native.manifest().nodes)).toEqual([]);
  } finally {
    release();
  }
  const id = await creating;
  expect(native.manifest().nodes[id]?.name).toBe('Large import');
  expect(native.files.get(id)).toEqual(new Uint8Array([4, 5, 6]));
  await repository.dispose();
});

it('keeps session subscriptions distinct and delivers metadata-only replacement events', async () => {
  const native = nativeBoundary();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'repository_operation') {
      const op = (args as { operation: Record<string, unknown> }).operation;
      if (op.kind === 'subscribe' || op.kind === 'unsubscribe') {
        native.operations.push(op);
        return;
      }
      if (op.kind === 'update-document') {
        native.operations.push(op);
        return {
          accepted: true,
          changed: true,
          stateVectorBase64: 'AA==',
          revision: 'native',
        };
      }
    }
    return implementation(command, args);
  });
  const repository = new NativeRepository({ kind: 'local' });
  const editor = vi.fn((_change: NativeDocumentChange) => {});
  const mcp = vi.fn((_change: NativeDocumentChange) => {});
  const closeEditor = await repository.subscribeDocument(
    'note',
    editor,
    'editor',
  );
  const closeMcp = await repository.subscribeDocument('note', mcp, 'mcp');
  expect(native.operations.filter((op) => op.kind === 'subscribe')).toEqual([
    { kind: 'subscribe', nodeId: 'note', sessionId: 'editor' },
    { kind: 'subscribe', nodeId: 'note', sessionId: 'mcp' },
  ]);
  await repository.persistDocumentUpdate(
    'note',
    new Uint8Array([1, 2]),
    'original',
    'editor',
  );
  expect(native.operations.at(-1)).toMatchObject({
    kind: 'update-document',
    sourceSession: 'editor',
    generation: 'original',
  });
  listeners.get('repository-document-mcp')?.({
    payload: {
      repositoryId: 'local',
      nodeId: 'note',
      updateBase64: 'AQI=',
      origin: 'local',
      generation: 'original',
      replacement: false,
    },
  });
  expect(editor).not.toHaveBeenCalled();
  expect(mcp).toHaveBeenCalledWith({
    update: new Uint8Array([1, 2]),
    origin: 'local',
    generation: 'original',
    replacement: false,
  });
  await closeEditor();
  expect(listeners.has('repository-document-editor')).toBe(false);
  expect(listeners.has('repository-document-mcp')).toBe(true);
  listeners.get('repository-document-mcp')?.({
    payload: {
      repositoryId: 'local',
      nodeId: 'note',
      origin: 'local',
      generation: 'replacement',
      replacement: true,
    },
  });
  expect(mcp).toHaveBeenLastCalledWith({
    update: null,
    origin: 'local',
    generation: 'replacement',
    replacement: true,
  });
  await closeMcp();
  expect(native.operations.filter((op) => op.kind === 'unsubscribe')).toEqual([
    { kind: 'unsubscribe', nodeId: 'note', sessionId: 'editor' },
    { kind: 'unsubscribe', nodeId: 'note', sessionId: 'mcp' },
  ]);
  await repository.dispose();
  expect(listeners.size).toBe(0);
});

it('imports picked raw files with paths and publishes only after Rust has stored them', async () => {
  const native = nativeBoundary();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const op = (args as { operation?: Record<string, unknown> })?.operation;
    if (command === 'repository_operation' && op?.kind === 'import-file') {
      native.operations.push(op);
      const node = op.node as { id: string };
      expect(native.manifest().nodes[node.id]).toBeUndefined();
      native.files.set(node.id, new Uint8Array([7, 8, 9]));
      return { revision: 'imported' };
    }
    return implementation(command, args);
  });
  const repository = new NativeRepository({ kind: 'local' });
  const job = filesProvider.createJob({
    selection: { kind: 'native-files', paths: ['/picked/photo.png'] },
    repository,
    parentId: null,
    strings: en,
  });
  await job.scan();
  const summary = await job.run({
    conflictResolution: 'rename',
    onProgress: () => {},
  });
  const id = summary.focusNodeId!;
  expect(native.manifest().nodes[id]?.name).toBe('photo.png');
  expect(native.files.get(id)).toEqual(new Uint8Array([7, 8, 9]));
  expect(native.operations.filter((op) => op.kind === 'import-file')).toEqual([
    {
      kind: 'import-file',
      node: native.manifest().nodes[id],
      path: '/picked/photo.png',
    },
  ]);
  expect(
    native.operations.some(
      (op) => op.kind === 'write-file' || op.kind === 'read-file',
    ),
  ).toBe(false);
  await repository.dispose();
});

it('routes note and frame renames to Rust without fetching or replacing file content', async () => {
  const native = nativeBoundary();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const op = (args as { operation?: Record<string, unknown> })?.operation;
    if (
      command === 'repository_operation' &&
      op?.kind === 'rename-references'
    ) {
      native.operations.push(op);
      return { sourceCount: 1, linkCount: 2 };
    }
    return implementation(command, args);
  });
  const repository = new NativeRepository({ kind: 'local' });
  const backlinks = ['owner', 'source', 'source'].map((sourceId) => ({
    sourceId,
    sourceName: sourceId,
    targetId: 'owner',
    pageFrameId: 'frame',
    title: 'Old#Draft',
    snippet: '',
  }));
  expect(
    await renameNoteReferences(repository, 'owner', 'New', backlinks),
  ).toEqual({ sourceCount: 1, linkCount: 2 });
  await renamePageFrameReferences(
    repository,
    'owner',
    'frame',
    'Final',
    backlinks,
  );
  expect(native.operations).toEqual([
    {
      kind: 'rename-references',
      sourceIds: ['owner', 'source'],
      targetId: 'owner',
      newName: 'New',
      referenceKind: 'note',
    },
    {
      kind: 'rename-references',
      sourceIds: ['source'],
      targetId: 'frame',
      newName: 'Final',
      referenceKind: 'page-frame',
    },
  ]);
  await repository.dispose();
});

it('paces large JS file writes in bounded chunks and never publishes partial bytes', async () => {
  const native = nativeBoundary();
  const bytes = Uint8Array.from({ length: 8192 * 2 + 1 }, (_, i) => i % 251);
  const repository = new NativeRepository({ kind: 'local' });
  const id = await repository.createFile('Large', 'png', null, bytes);
  expect(native.files.get(id)).toEqual(bytes);
  const chunks = native.operations.filter((op) => op.kind === 'stage-bytes');
  expect(
    chunks.map((op) => Buffer.from(op.bytesBase64 as string, 'base64').length),
  ).toEqual([8192, 8192, 1]);
  expect(chunks.map((op) => op.offset)).toEqual([0, 8192, 16384]);
  expect(native.operations.some((op) => op.kind === 'write-file')).toBe(false);
  expect(
    native.operations.findIndex((op) => op.kind === 'finish-transfer'),
  ).toBeLessThan(
    native.operations.findIndex((op) => op.kind === 'save-manifest'),
  );
  await repository.dispose();
});

it('cancels a failed JS transfer without publishing a new file', async () => {
  const native = nativeBoundary();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const op = (args as { operation?: Record<string, unknown> })?.operation;
    if (op?.kind === 'stage-bytes' && op.offset === 8192) {
      throw new Error('Transfer interrupted');
    }
    return implementation(command, args);
  });
  const repository = new NativeRepository({ kind: 'local' });
  await expect(
    repository.createFile('Failed', 'png', null, new Uint8Array(8193)),
  ).rejects.toThrow('Transfer interrupted');
  expect(native.manifest().nodes).toEqual({});
  expect(native.files.size).toBe(0);
  expect(native.operations.at(-1)?.kind).toBe('cancel-transfer');
  await repository.dispose();
});

it('saves a JS-generated canvas import through bounded native document transfers', async () => {
  const native = nativeBoundary();
  const repository = new NativeRepository({ kind: 'local' });
  const bytes = Uint8Array.from({ length: 20000 }, (_, i) => i % 251);
  const id = await createCanvasFile({
    repository,
    parentId: null,
    title: 'Generated',
    label: 'Test',
    build: (ydoc) => {
      ydoc.doc.getMap('asset').set('bytes', bytes);
    },
  });
  expect(native.documents.get(id)?.getMap('asset').get('bytes')).toEqual(bytes);
  const chunks = native.operations.filter((op) => op.kind === 'stage-bytes');
  expect(chunks.length).toBeGreaterThan(1);
  expect(
    chunks.every(
      (op) => Buffer.from(op.bytesBase64 as string, 'base64').length <= 8192,
    ),
  ).toBe(true);
  const finish = native.operations.find((op) => op.kind === 'finish-transfer');
  expect(finish?.operation).toMatchObject({
    kind: 'update-document',
    nodeId: id,
    generation: 'original',
    origin: 'local',
    updateBase64: '',
  });
  expect(native.operations.some((op) => op.kind === 'update-document')).toBe(
    false,
  );
  await repository.dispose();
});
