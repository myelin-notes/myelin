import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { CachedRepository } from './cached';
import { GitHubRepository } from './github';
import { getGoogleDriveToken } from './google-drive/credentials';
import { LocalRepository } from './local';
import { createNativeRepositoryBootstrap } from './native-bootstrap';
import { createEmptyManifest, createFileNode } from './shared';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
  invoke: vi.fn(),
  isTauri: () => true,
}));

const config = {
  kind: 'github' as const,
  owner: 'owner',
  repo: 'repo',
  branch: 'main',
  credentialId: 'default',
};
const root = 'repositories/github/owner__repo__main';

function createBootstrapRepository() {
  return new CachedRepository(
    new GitHubRepository({
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
      credentialId: config.credentialId,
    }),
    new LocalRepository(root),
    `${root}/outbox.json`,
    createNativeRepositoryBootstrap(config, root) ?? undefined,
  );
}

describe('native repository bootstrap', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
    vi.mocked(invoke).mockReset();
  });

  it('installs through Rust, reloads cache metadata, and keeps success when stage cleanup fails', async () => {
    const storage = getRepositoryTestStorage();
    const manifest = createEmptyManifest();
    manifest.nodes.note = createFileNode(
      'note',
      'Remote image',
      'png',
      null,
      1,
    );
    const commands: string[] = [];
    vi.mocked(invoke).mockImplementation(async (command) => {
      commands.push(command);
      switch (command) {
        case 'recover_repository_cache':
          expect(storage.readText(`${root}/manifest.json`)).toBeNull();
          return undefined;
        case 'prepare_repository_cache':
          expect(storage.readText(`${root}/manifest.json`)).not.toBeNull();
          return { stageId: 'stage', fileCount: 1, byteLength: 3 };
        case 'install_repository_cache':
          await storage.writeTextFile(
            `${root}/manifest.json`,
            JSON.stringify(manifest),
          );
          await storage.writeFile(
            `${root}/files/note.png`,
            new Uint8Array([1, 2, 3]),
          );
          return true;
        case 'discard_repository_cache':
          throw new Error('temporary cleanup failure');
        default:
          throw new Error(`Unexpected native command: ${command}`);
      }
    });
    const exportSnapshot = vi.spyOn(
      GitHubRepository.prototype,
      'exportSnapshot',
    );
    const replaceSnapshot = vi.spyOn(
      LocalRepository.prototype,
      'replaceSnapshot',
    );
    try {
      const repository = createBootstrapRepository();
      await repository.initialize();
      expect((await repository.getNode('note'))?.name).toBe('Remote image');
      expect(await repository.readFileBytes('note')).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      expect(repository.getRuntimeStatus()).toMatchObject({
        online: true,
        lastError: null,
      });
      expect(exportSnapshot).not.toHaveBeenCalled();
      expect(replaceSnapshot).not.toHaveBeenCalled();
      expect(commands).toEqual([
        'recover_repository_cache',
        'prepare_repository_cache',
        'install_repository_cache',
        'discard_repository_cache',
      ]);
    } finally {
      exportSnapshot.mockRestore();
      replaceSnapshot.mockRestore();
    }
  });

  it('keeps local editing responsive during native download and rejects its staged replacement after an edit', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let prepared!: () => void;
    const started = new Promise<void>((resolve) => {
      prepared = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'prepare_repository_cache') {
        prepared();
        await gate;
        return { stageId: 'stage', fileCount: 0, byteLength: 0 };
      }
      return undefined;
    });
    const repository = createBootstrapRepository();
    const initializing = repository.initialize();
    await started;
    const folderId = await repository.createFolder('Offline edit', null);
    release();
    await initializing;
    expect((await repository.getNode(folderId))?.name).toBe('Offline edit');
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(1);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      'recover_repository_cache',
      'prepare_repository_cache',
      'discard_repository_cache',
    ]);
    const reopened = createBootstrapRepository();
    await reopened.initialize();
    expect((await reopened.getNode(folderId))?.name).toBe('Offline edit');
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(
          ([command]) => command === 'prepare_repository_cache',
        ),
    ).toHaveLength(1);
  });

  it('retries a failed initial bootstrap through Rust and refreshes an expired Drive token once', async () => {
    vi.mocked(invoke)
      .mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce('temporary download failure');
    const repository = createBootstrapRepository();
    await repository.initialize();
    expect(repository.getRuntimeStatus().online).toBe(false);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'prepare_repository_cache') {
        return { stageId: 'retry', fileCount: 0, byteLength: 0 };
      }
      return command === 'install_repository_cache' ? true : undefined;
    });
    await repository.refresh();
    expect(repository.getRuntimeStatus().online).toBe(true);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(
          ([command]) => command === 'prepare_repository_cache',
        ),
    ).toHaveLength(2);

    vi.mocked(invoke).mockReset();
    vi.mocked(getGoogleDriveToken).mockClear();
    vi.mocked(invoke)
      .mockRejectedValueOnce('Google Drive download failed (401)')
      .mockResolvedValueOnce({ stageId: 'drive', fileCount: 0, byteLength: 0 });
    const drive = createNativeRepositoryBootstrap(
      {
        kind: 'google-drive',
        folderId: 'folder',
        folderName: 'Notes',
        credentialId: 'work',
      },
      'repositories/google-drive/folder',
    );
    await drive!.prepare();
    expect(vi.mocked(getGoogleDriveToken).mock.calls).toEqual([
      ['work', { forceRefresh: false }],
      ['work', { forceRefresh: true }],
    ]);
  });
});
