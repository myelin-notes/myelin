import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { pushGitHubBatch } from './github-git-push';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

beforeEach(() => {
  resetRepositoryTestDoubles();
  vi.mocked(invoke).mockReset();
});

it('stages raw bytes and sends only paths to embedded Git, then removes staging', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  let stagedPath = '';
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const request = (args as { request: { stagingId: string } }).request;
    stagedPath = `git-sync/${request.stagingId}`;
    expect(getRepositoryTestStorage().readBinary(`${stagedPath}/0`)).toEqual(
      bytes,
    );
    return { status: 'pushed', commitOid: 'a'.repeat(40), blobShas: {} };
  });

  await pushGitHubBatch(
    { owner: 'myelin', repo: 'notes', branch: 'main' },
    {
      additions: [{ path: 'files/original.myelin', contents: bytes }],
      deletions: [{ path: 'files/removed.myelin' }],
      expectedHeadOid: 'b'.repeat(40),
      message: { headline: 'Sync change' },
    },
    'private-token',
  );

  expect(invoke).toHaveBeenCalledWith(
    'github_push_batch',
    expect.objectContaining({
      request: expect.objectContaining({
        token: 'private-token',
        additions: [{ path: 'files/original.myelin', index: 0 }],
        deletions: ['files/removed.myelin'],
      }),
    }),
  );
  expect(await getRepositoryTestStorage().exists(stagedPath)).toBe(false);
});

it('stages large bytes in bounded writes and completes partial writes', async () => {
  const storage = getRepositoryTestStorage();
  const originalOpen = storage.open.bind(storage);
  let largestWrite = 0;
  vi.spyOn(storage, 'open').mockImplementation(async (...args) => {
    const file = await originalOpen(...args);
    return {
      close: () => file.close(),
      write: (data: Uint8Array) => {
        largestWrite = Math.max(largestWrite, data.byteLength);
        return file.write(
          data.subarray(0, Math.min(data.byteLength, 256 * 1024)),
        );
      },
    };
  });
  const bytes = new Uint8Array(2 * 1024 * 1024 + 1);
  bytes[0] = 7;
  bytes[bytes.length - 1] = 9;
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const request = (args as { request: { stagingId: string } }).request;
    expect(storage.readBinary(`git-sync/${request.stagingId}/0`)).toEqual(
      bytes,
    );
    return { status: 'pushed', commitOid: 'a'.repeat(40), blobShas: {} };
  });

  await pushGitHubBatch(
    { owner: 'myelin', repo: 'notes', branch: 'main' },
    {
      additions: [{ path: 'files/large.myelin', contents: bytes }],
      deletions: [],
      expectedHeadOid: 'b'.repeat(40),
      message: { headline: 'Sync change' },
    },
    'private-token',
  );

  expect(largestWrite).toBeLessThanOrEqual(1024 * 1024);
});
