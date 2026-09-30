import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { NativeRepository } from './native';
import { createRepositoryFromConfig } from './repository-backends';
import {
  createEmptyManifest,
  createFileNode,
  type VFSManifest,
} from './shared';

const { listeners } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
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
    const op = (args as { operation: Record<string, unknown> }).operation;
    operations.push(op);
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
      case 'path':
        return null;
      default:
        throw new Error(`Unexpected operation ${String(op.kind)}`);
    }
  });
  return {
    files,
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

it('marks ordinary raw writes for conflict checking and only restores as cloud replacements', async () => {
  const native = nativeBoundary();
  const repository = new NativeRepository({ kind: 'local' });
  await repository.initialize();
  const id = await repository.createFile(
    'Image',
    'png',
    null,
    new Uint8Array([1, 2]),
  );
  await repository.writeFileBytes(id, new Uint8Array([2, 3]));
  const ordinary = native.operations
    .filter((op) => op.kind === 'write-file')
    .at(-1);
  expect(ordinary?.overwriteRemote).toBe(false);
  native.manifest().nodes.version = {
    ...createFileNode('version', 'Saved image', 'png', null, 1),
    system: {
      kind: 'file-version',
      sourceFileId: id,
      sourceFileType: 'png',
      sourceName: 'Image',
      sourceRevision: 'old',
      capturedAt: 1,
      byteLength: 2,
    },
  };
  native.files.set('version', new Uint8Array([4, 5]));
  await repository.restoreFileVersion(id, 'version');
  const restores = native.operations.filter(
    (op) => op.kind === 'write-file' && (op.node as { id: string }).id === id,
  );
  expect(restores.at(-1)?.overwriteRemote).toBe(true);
  expect(await repository.readFileBytes(id)).toEqual(new Uint8Array([4, 5]));
  expect(
    Object.values(native.manifest().nodes).some(
      (node) => node.system?.kind === 'file-version' && node.id !== 'version',
    ),
  ).toBe(true);
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
