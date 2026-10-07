import * as scoped from 'tauri-plugin-scoped-storage-api';
import { beforeEach, expect, it, vi } from 'vitest';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as Y from 'yjs';
import { ElementType } from '@myelin/editor/elements/element-type';
import en from '@myelin/editor/i18n/messages/en';
import { schema } from '@myelin/editor/page-frame/pm/schema';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { invoke } from '@tauri-apps/api/core';
import { trackEvent } from '@/lib/analytics';
import { createCanvasFile } from '@/pages/library/import/canvas-file';
import { importGoodnotesZip } from '@/pages/library/import/goodnotes';
import { importObsidianVault } from '@/pages/library/import/obsidian-vault';
import { filesProvider } from '@/pages/library/import/providers/files';
import { onenoteProvider } from '@/pages/library/import/providers/onenote';
import { importWorkspaceJson } from '@/pages/library/import/workspace-json';
import type { NativeDocumentChange } from '../native-document-target';
import {
  GITHUB_SIGN_IN_REQUIRED,
  getGitHubToken,
  requireGitHubSignIn,
} from './github/credentials';
import {
  GOOGLE_DRIVE_SIGN_IN_REQUIRED,
  getGoogleDriveToken,
  requireGoogleDriveSignIn,
} from './google-drive/credentials';
import { NativeRepository } from './native';
import type { MetadataPatch } from './native-operations';
import { renameNoteReferences } from './rename-note-references';
import { renamePageFrameReferences } from './rename-page-frame-references';
import { createRepositoryFromConfig } from './repository-backends';
import { createEmptyManifest } from './shared';

const { listeners } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@myelin/editor/pdf-renderer', () => ({
  createDefaultPdfPageOrder: (pageCount: number) =>
    Array.from({ length: pageCount }, (_, originalIndex) => ({
      kind: 'pdf',
      originalIndex,
    })),
  getPdfPageSizes: vi.fn(async () => [{ w: 680, h: 880 }]),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage = (_value: unknown) => {};
  },
  convertFileSrc: (path: string) => path,
}));
vi.mock('tauri-plugin-scoped-storage-api', () => ({
  readDir: vi.fn(),
  readFile: vi.fn(() => {
    throw new Error('Raw imports must be read by Rust');
  }),
  readTextFile: vi.fn(),
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
  getGitHubToken: vi.fn(async () => 'token'),
  requireGitHubSignIn: vi.fn(async () => {}),
  GITHUB_SIGN_IN_REQUIRED: 'Sign in again from Settings',
  hasGitHubToken: async () => true,
}));

beforeEach(() => {
  listeners.clear();
  vi.mocked(invoke).mockReset();
});

function nativeBoundary() {
  const manifest = createEmptyManifest();
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
      case 'save-metadata': {
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
          throw new Error('Native metadata conflict');
        }
        const patch = op.patch as MetadataPatch;
        for (const { node, links } of patch.nodes) {
          manifest.nodes[node.id] = structuredClone(node);
          if (links.length) {
            manifest.linksBySource[node.id] = structuredClone(links);
          } else {
            delete manifest.linksBySource[node.id];
          }
        }
        for (const id of patch.deletedNodeIds) {
          delete manifest.nodes[id];
          delete manifest.linksBySource[id];
        }
        if (patch.settings) {
          Object.assign(manifest, structuredClone(patch.settings));
        }
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
      case 'delete-file':
        files.delete(op.nodeId as string);
        return null;
      case 'document': {
        const node = manifest.nodes[op.nodeId as string];
        if (node?.type !== 'file' || node.fileType !== 'mcanvas') {
          throw new Error('Cannot open this file as a canvas document');
        }
        let doc = documents.get(node.id);
        if (!doc) {
          doc = new Y.Doc();
          const bytes = files.get(node.id);
          if (bytes) {
            Y.applyUpdate(doc, bytes);
          }
          documents.set(node.id, doc);
        }
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
  let folderId = '';
  native.compete();
  await repository.batchMetadataWrites(async () => {
    const folder = await repository.createFolder('Imported', null);
    folderId = folder;
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
  const rename = native.operations.at(-1)!;
  expect(rename).not.toHaveProperty('manifest');
  expect(rename).toMatchObject({
    kind: 'save-metadata',
    patch: { deletedNodeIds: [], settings: null },
  });
  expect(
    (rename.patch as MetadataPatch).nodes.map(({ node }) => node.id),
  ).toEqual([fileId]);
  await repository.addCustomColor('#abcdef', 'pen');
  expect(native.operations.at(-1)).toMatchObject({
    kind: 'save-metadata',
    patch: {
      nodes: [],
      deletedNodeIds: [],
      settings: { colors: { pen: ['#123456', '#abcdef'] } },
    },
  });
  expect(native.manifest().nodes[fileId]?.name).toBe('Renamed');
  const before = repository.getRuntimeStatus().dataVersion;
  listeners.get('repository-status')?.({
    payload: {
      ...native.status(),
      dataVersion: native.status().dataVersion + 1,
    },
  });
  expect(repository.getRuntimeStatus().dataVersion).toBeGreaterThan(before);
  await repository.deleteNode(folderId);
  const deletion = native.operations
    .filter((op) => op.kind === 'save-metadata')
    .at(-1)!;
  expect((deletion.patch as MetadataPatch).deletedNodeIds.sort()).toEqual(
    [folderId, fileId].sort(),
  );
  expect((deletion.patch as MetadataPatch).nodes).toEqual([]);
  expect(native.manifest().nodes[folderId]).toBeUndefined();
  expect(native.files.has(fileId)).toBe(false);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.every(([command]) => command.startsWith('repository_')),
  ).toBe(true);
  await repository.dispose();
  expect(listeners.size).toBe(0);
});

it('forwards GitHub refresh requests and turns a final 401 into a sign-in prompt', async () => {
  nativeBoundary();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'repository_auth_response') {
      return;
    }
    if (command === 'repository_sync') {
      throw 'GitHub request failed (401): Bad credentials';
    }
    return implementation(command, args);
  });
  const repository = createRepositoryFromConfig({
    kind: 'github',
    owner: 'me',
    repo: 'notes',
    branch: 'main',
    credentialId: 'account',
  });
  await repository.initialize();
  listeners.get('repository-auth-request')!({
    payload: {
      repositoryId: 'repositories/github/me__notes__main',
      credentialId: 'account',
      requestId: 'auth',
      forceRefresh: true,
    },
  });
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('repository_auth_response', {
      requestId: 'auth',
      token: 'token',
    }),
  );
  expect(getGitHubToken).toHaveBeenLastCalledWith('account', {
    forceRefresh: true,
  });
  listeners.get('repository-status')!({
    payload: {
      repositoryId: 'repositories/github/me__notes__main',
      online: false,
      pendingRemoteWrites: 1,
      lastRemoteSyncAt: null,
      dataVersion: 0,
      lastError: 'GitHub request failed (401): Bad credentials',
    },
  });
  expect(repository.getRuntimeStatus().lastError?.message).toBe(
    GITHUB_SIGN_IN_REQUIRED,
  );
  await expect(repository.refresh()).rejects.toThrow(GITHUB_SIGN_IN_REQUIRED);
  expect(requireGitHubSignIn).toHaveBeenCalledWith('account');
  await repository.dispose();
});

it('refreshes Drive authentication only for its repository and credential', async () => {
  nativeBoundary();
  vi.mocked(requireGoogleDriveSignIn).mockClear();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'repository_auth_response') {
      return;
    }
    if (command === 'repository_sync') {
      throw 'Google Drive request failed (401): Unauthorized';
    }
    return implementation(command, args);
  });
  const token = vi.mocked(getGoogleDriveToken);
  token.mockClear();
  token
    .mockResolvedValueOnce('initial-token')
    .mockResolvedValueOnce('refreshed-token');
  const repository = createRepositoryFromConfig({
    kind: 'google-drive',
    folderName: 'Notes',
    folderId: 'drive-folder',
    credentialId: 'drive-account',
  });
  await repository.initialize();
  expect(invoke).toHaveBeenCalledWith('repository_open', {
    request: {
      storageRoot: 'repositories/google-drive/drive-folder',
      credentialId: 'drive-account',
      source: {
        kind: 'google-drive',
        folderId: 'drive-folder',
        token: 'initial-token',
      },
    },
  });
  const authenticate = listeners.get('repository-auth-request')!;
  const request = {
    repositoryId: 'repositories/google-drive/drive-folder',
    credentialId: 'drive-account',
    requestId: 'auth',
    forceRefresh: true,
  };
  authenticate({ payload: { ...request, repositoryId: 'another-repository' } });
  authenticate({ payload: { ...request, credentialId: 'another-account' } });
  expect(token).toHaveBeenCalledTimes(1);
  authenticate({ payload: request });
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('repository_auth_response', {
      requestId: 'auth',
      token: 'refreshed-token',
    }),
  );
  expect(token).toHaveBeenLastCalledWith('drive-account', {
    forceRefresh: true,
  });
  listeners.get('repository-status')!({
    payload: {
      repositoryId: 'repositories/google-drive/drive-folder',
      online: false,
      pendingRemoteWrites: 1,
      lastRemoteSyncAt: null,
      dataVersion: 0,
      lastError: 'Google Drive request failed (401): Unauthorized',
    },
  });
  expect(repository.getRuntimeStatus().lastError?.message).toBe(
    GOOGLE_DRIVE_SIGN_IN_REQUIRED,
  );
  expect(requireGoogleDriveSignIn).toHaveBeenCalledWith('drive-account');
  await expect(repository.refresh()).rejects.toThrow(
    GOOGLE_DRIVE_SIGN_IN_REQUIRED,
  );
  await repository.dispose();
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
  const repository = createRepositoryFromConfig({ kind: 'local' });
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
  const repository = createRepositoryFromConfig({ kind: 'local' });
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

it.each([
  { kind: 'create', failureFirst: false },
  { kind: 'create', failureFirst: true },
  { kind: 'import', failureFirst: false },
  { kind: 'import', failureFirst: true },
])('isolates overlapping $kind calls when failureFirst=$failureFirst', async ({
  kind,
  failureFirst,
}) => {
  const native = nativeBoundary();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  let rejectFailure!: (error: Error) => void;
  let releaseSuccess!: () => void;
  const failureGate = new Promise<void>((_resolve, reject) => {
    rejectFailure = reject;
  });
  const successGate = new Promise<void>((resolve) => {
    releaseSuccess = resolve;
  });
  const started = new Set<string>();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const op = (args as { operation?: Record<string, unknown> })?.operation;
    if (
      command === 'repository_operation' &&
      (op?.kind === 'write-file' || op?.kind === 'import-file')
    ) {
      const node = op.node as { id: string; name: string };
      started.add(node.name);
      await (node.name === 'Failed' ? failureGate : successGate);
      if (op.kind === 'import-file') {
        native.files.set(node.id, new Uint8Array([7, 8, 9]));
        return { revision: 'imported' };
      }
    }
    return implementation(command, args);
  });
  const repository = createRepositoryFromConfig({ kind: 'local' });
  const create = (name: string) =>
    kind === 'create'
      ? repository.createFile(name, 'png', null, new Uint8Array([7, 8, 9]))
      : repository.importFile(name, 'png', null, {
          kind: 'path',
          path: `/picked/${name}.png`,
        });
  const failed = create('Failed').catch((error: unknown) => error);
  await vi.waitFor(() => expect(started.has('Failed')).toBe(true));
  const succeeded = create('Success');
  await vi.waitFor(() => expect(started.has('Success')).toBe(true));
  if (failureFirst) {
    rejectFailure(new Error('Disk failed'));
    await failed;
  }
  releaseSuccess();
  const id = await succeeded;
  const publishedAtAcknowledgement = native.manifest().nodes[id]?.name;
  if (!failureFirst) {
    rejectFailure(new Error('Disk failed'));
  }
  expect(await failed).toEqual(new Error('Disk failed'));
  expect(publishedAtAcknowledgement).toBe('Success');
  expect(
    Object.values(native.manifest().nodes).map((node) => node.name),
  ).toEqual(['Success']);
  expect(native.files.get(id)).toEqual(new Uint8Array([7, 8, 9]));
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
  const repository = createRepositoryFromConfig({ kind: 'local' });
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

it.each([
  { path: '/picked/photo.png', name: 'photo.png' },
  { path: 'content://provider/document/123', name: 'holiday photo.png' },
  { path: 'file:///picked/holiday%20photo.png', name: 'holiday photo.png' },
])('imports picked raw files from $path and publishes only after Rust has stored them', async ({
  path,
  name,
}) => {
  const native = nativeBoundary();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'import_file_name') {
      expect(args).toEqual({ path });
      return name;
    }
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
  const repository = createRepositoryFromConfig({ kind: 'local' });
  const job = filesProvider.createJob({
    selection: { kind: 'native-files', paths: [path] },
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
  expect(native.manifest().nodes[id]?.name).toBe(name);
  expect(native.files.get(id)).toEqual(new Uint8Array([7, 8, 9]));
  expect(native.operations.filter((op) => op.kind === 'import-file')).toEqual([
    {
      kind: 'import-file',
      node: native.manifest().nodes[id],
      source: { kind: 'path', path },
    },
  ]);
  expect(
    native.operations.some(
      (op) => op.kind === 'write-file' || op.kind === 'read-file',
    ),
  ).toBe(false);
  await repository.dispose();
});

it.each([
  'obsidian',
  'json',
])('imports scoped %s media without reading bytes into JS', async (format) => {
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
  vi.mocked(scoped.readDir).mockImplementation(async (id, path) => {
    expect(id).toBe('picked-folder');
    return path === ''
      ? [{ name: 'Nested', path: 'Nested', isDir: true, isFile: false }]
      : [
          {
            name: 'photo.png',
            path: 'Nested/photo.png',
            isDir: false,
            isFile: true,
          },
        ];
  });
  const repository = createRepositoryFromConfig({ kind: 'local' });
  const folder = {
    kind: 'scoped' as const,
    handle: { id: 'picked-folder', name: 'Imported' },
  };
  const result =
    format === 'obsidian'
      ? await importObsidianVault({
          repository,
          parentId: null,
          vaultPath: folder,
        })
      : await importWorkspaceJson({
          repository,
          parentId: null,
          dirPath: folder,
        });
  expect(result.mediaImported).toBe(1);
  const imported = native.operations.find((op) => op.kind === 'import-file')!;
  expect(imported.source).toEqual({
    kind: 'scoped',
    folderId: 'picked-folder',
    path: 'Nested/photo.png',
  });
  const node = imported.node as { id: string };
  expect(native.files.get(node.id)).toEqual(new Uint8Array([7, 8, 9]));
  expect(native.manifest().nodes[node.id]?.name).toBe('photo.png');
  expect(
    native.operations.some(
      (op) =>
        op.kind === 'stage-bytes' ||
        op.kind === 'read-file' ||
        op.kind === 'write-file',
    ),
  ).toBe(false);
  await repository.dispose();
});

it('leaves a revoked scoped-folder import unpublished', async () => {
  const native = nativeBoundary();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const op = (args as { operation?: Record<string, unknown> })?.operation;
    if (command === 'repository_operation' && op?.kind === 'import-file') {
      throw new Error('Folder permission revoked');
    }
    return implementation(command, args);
  });
  const repository = createRepositoryFromConfig({ kind: 'local' });
  await expect(
    repository.importFile('photo.png', 'png', null, {
      kind: 'scoped',
      folderId: 'revoked-folder',
      path: 'photo.png',
    }),
  ).rejects.toThrow('Folder permission revoked');
  expect(native.manifest().nodes).toEqual({});
  expect(native.files.size).toBe(0);
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
  const repository = createRepositoryFromConfig({ kind: 'local' });
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
  const repository = createRepositoryFromConfig({ kind: 'local' });
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
    native.operations.findIndex((op) => op.kind === 'save-metadata'),
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
  const repository = createRepositoryFromConfig({ kind: 'local' });
  await expect(
    repository.createFile('Failed', 'png', null, new Uint8Array(8193)),
  ).rejects.toThrow('Transfer interrupted');
  expect(native.manifest().nodes).toEqual({});
  expect(native.files.size).toBe(0);
  expect(native.operations.at(-1)?.kind).toBe('cancel-transfer');
  await repository.dispose();
});

it('saves a JS-generated canvas import through bounded native byte transfers', async () => {
  const native = nativeBoundary();
  const repository = createRepositoryFromConfig({ kind: 'local' });
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
  const doc = new Y.Doc();
  Y.applyUpdate(doc, native.files.get(id)!);
  expect(doc.getMap('asset').get('bytes')).toEqual(bytes);
  const chunks = native.operations.filter((op) => op.kind === 'stage-bytes');
  expect(chunks.length).toBeGreaterThan(1);
  expect(
    chunks.every(
      (op) => Buffer.from(op.bytesBase64 as string, 'base64').length <= 8192,
    ),
  ).toBe(true);
  const finish = native.operations.find((op) => op.kind === 'finish-transfer');
  expect(finish?.operation).toMatchObject({
    kind: 'write-file',
    node: { id },
    bytesBase64: '',
  });
  expect(native.operations.some((op) => op.kind === 'update-document')).toBe(
    false,
  );
  await repository.dispose();
});

it('imports OneNote entirely through Rust while keeping preview and progress in JS', async () => {
  const native = nativeBoundary();
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  const result = {
    rootFolderId: 'imported-root',
    pagesImported: 2,
    skippedPages: 0,
  };
  let imported: Record<string, unknown> | undefined;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'scan_onenote') {
      expect(args).toEqual({ path: '/picked/Notebook.onepkg' });
      return { pages: 2, sections: 1 };
    }
    const op = (args as { operation?: Record<string, unknown> })?.operation;
    if (command === 'repository_operation' && op?.kind === 'import-one-note') {
      expect(args).toMatchObject({ handle: 'native-handle' });
      imported = op;
      (op.progress as { onmessage(value: unknown): void }).onmessage({
        current: 1,
        total: 2,
        fileName: 'Page',
      });
      return result;
    }
    return implementation(command, args);
  });
  const repository = createRepositoryFromConfig({ kind: 'local' });
  const job = onenoteProvider.createJob({
    selection: { kind: 'file', path: '/picked/Notebook.onepkg' },
    repository,
    parentId: null,
    strings: en,
  });
  const preview = await job.scan();
  expect(preview.name).toBe('Notebook');
  expect(preview.lines.map((line) => line.text)).toEqual([
    en.library.importSources.onenote.pages(2),
    en.library.importSources.onenote.sections(1),
  ]);
  const onProgress = vi.fn();
  const summary = await job.run({ conflictResolution: 'rename', onProgress });
  expect(imported).toMatchObject({
    kind: 'import-one-note',
    path: '/picked/Notebook.onepkg',
    parentId: null,
    rootName: 'Notebook',
    fallbackTitle: en.library.createNew.untitledCanvas,
  });
  expect(onProgress).toHaveBeenCalledWith({
    current: 1,
    total: 2,
    fileName: 'Page',
  });
  expect(summary.focusNodeId).toBe(result.rootFolderId);
  expect(summary.stats).toEqual({ count: 2, skipped: 0 });
  expect(native.operations.map((op) => op.kind)).toEqual(['manifest']);
  await repository.dispose();
});

it('imports Obsidian notes and PDFs before publishing their manifest', async () => {
  const native = nativeBoundary();
  vi.mocked(scoped.readTextFile).mockImplementation(async (_id, path) =>
    path === 'Alpha.md'
      ? '---\ntags: [project]\n---\nSee [[Beta]].'
      : 'Beta body',
  );
  vi.mocked(scoped.readFile).mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
  const repository = createRepositoryFromConfig({ kind: 'local' });
  const result = await importObsidianVault({
    repository,
    parentId: null,
    vaultPath: { kind: 'scoped', handle: { id: 'folder', name: 'Vault' } },
    scanned: {
      folderPaths: new Set(),
      skippedFiles: 0,
      files: [
        {
          kind: 'markdown',
          sourcePath: 'Alpha.md',
          folderPath: '',
          name: 'Alpha.md',
          noteName: 'Alpha',
          notePath: 'Alpha',
          nodeId: null,
        },
        {
          kind: 'markdown',
          sourcePath: 'Beta.md',
          folderPath: '',
          name: 'Beta.md',
          noteName: 'Beta',
          notePath: 'Beta',
          nodeId: null,
        },
        {
          kind: 'pdf',
          sourcePath: 'Deck.pdf',
          folderPath: '',
          name: 'Deck.pdf',
        },
      ],
    },
  });
  expect(result.notesImported).toBe(2);
  expect(result.mediaImported).toBe(1);
  const [, nodes] = await repository.listDirectory(result.rootFolderId);
  const alpha = nodes.find((node) => node.name === 'Alpha')!;
  const beta = nodes.find((node) => node.name === 'Beta')!;
  const pdf = nodes.find((node) => node.name === 'Deck')!;
  expect(alpha.tags).toEqual(['project']);
  const session = await repository.openSession(alpha.id);
  const frame = session.ydoc.elements.get(0);
  const content = yXmlFragmentToProseMirrorRootNode(
    session.ydoc.getXmlFragment(frame.get('uuid') as string),
    schema,
  );
  expect(content.textContent).toBe('See [[Beta]].');
  expect(JSON.stringify(content.toJSON())).toContain(beta.id);
  await session.close();
  const pdfDoc = new YDocManager();
  Y.applyUpdate(pdfDoc.doc, native.files.get(pdf.id)!);
  expect(pdfDoc.elements.get(0).get('pdfData')).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  await repository.dispose();
});

it('imports a Goodnotes ZIP canvas while its manifest is unpublished', async () => {
  const native = nativeBoundary();
  const repository = createRepositoryFromConfig({ kind: 'local' });
  const result = await importGoodnotesZip({
    scanned: {
      pdfEntries: [
        {
          path: 'Unit/Deck.pdf',
          folderPath: 'Unit',
          fileName: 'Deck.pdf',
          bytes: new Uint8Array([4, 5, 6]),
        },
      ],
      skippedFiles: 0,
    },
    repository,
    parentId: null,
    fallbackTitle: 'Untitled Canvas',
  });
  expect(result.pdfsImported).toBe(1);
  const node = Object.values(native.manifest().nodes).find(
    (node) => node.type === 'file',
  )!;
  const doc = new YDocManager();
  Y.applyUpdate(doc.doc, native.files.get(node.id)!);
  expect(doc.elements.get(0).get('type')).toBe(ElementType.PDF);
  expect(doc.elements.get(0).get('pdfData')).toEqual(new Uint8Array([4, 5, 6]));
  expect(native.operations.some((op) => op.kind === 'document')).toBe(false);
  await repository.dispose();
});

it('reports sync diagnostics only for the active repository and releases the listener', async () => {
  nativeBoundary();
  vi.mocked(trackEvent).mockClear();
  const repository = await createRepositoryFromConfig({ kind: 'local' });
  await repository.initialize();
  const report = listeners.get('repository-sync-diagnostics')!;
  const properties = {
    sync_id: 'sync-1',
    duration_ms: 93000,
    git_fetch_ms: 90000,
  };
  report({ payload: { repositoryId: 'another-repository', properties } });
  expect(trackEvent).not.toHaveBeenCalled();
  report({ payload: { repositoryId: 'local', properties } });
  expect(trackEvent).toHaveBeenCalledExactlyOnceWith(
    'sync_diagnostics',
    properties,
  );
  await repository.dispose();
  expect(listeners.has('repository-sync-diagnostics')).toBe(false);
  report({ payload: { repositoryId: 'local', properties } });
  expect(trackEvent).toHaveBeenCalledTimes(1);
});
