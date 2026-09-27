import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { trackEvent } from '@/lib/analytics';
import {
  createNoteState,
  getRepositoryTestGitHubApi,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { BatchUnknownError } from './batch';
import { CachedRepository } from './cached';
import { GitHubRepository } from './github';
import { pushGitHubBatch } from './github-git-push';
import { LocalRepository } from './local';
import { getStoredFilePath } from './shared';

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('./github-git-push', () => ({ pushGitHubBatch: vi.fn() }));

function buildRepository(suffix: string) {
  const remote = new GitHubRepository({
    owner: 'myelin',
    repo: 'notes',
    branch: 'main',
    credentialId: 'test-credential',
  });
  const cache = new LocalRepository(`repositories/${suffix}`);
  const repository = new CachedRepository(
    remote,
    cache,
    `repositories/${suffix}/outbox.json`,
  );
  return { remote, cache, repository };
}

function mockPush() {
  vi.mocked(pushGitHubBatch).mockImplementation(async (_config, input) =>
    getRepositoryTestGitHubApi().applyGitPush(
      input.additions,
      input.deletions,
      input.expectedHeadOid,
    ),
  );
}

describe('CachedRepository GitHub Git pushes', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
    vi.mocked(trackEvent).mockClear();
    vi.mocked(pushGitHubBatch).mockReset();
    mockPush();
  });

  it('commits small queued changes through embedded Git', async () => {
    const { repository } = buildRepository('git-small-batch');
    await repository.initialize();
    const baseline = vi.mocked(pushGitHubBatch).mock.calls.length;
    const first = await repository.createFile('First', 'mcanvas', null);
    const second = await repository.createFile('Second', 'mcanvas', null);
    const note = createNoteState('content');
    await repository.pushUpdates(first, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });
    await repository.pushUpdates(second, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    await repository.flushPending();

    expect(vi.mocked(pushGitHubBatch).mock.calls.length - baseline).toBe(1);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('replans after a branch head conflict and preserves the queued change', async () => {
    const { repository } = buildRepository('git-conflict');
    await repository.initialize();
    await repository.createFile('Retry', 'mp4', null, new Uint8Array([1]));
    const push = vi.mocked(pushGitHubBatch);
    const baseline = push.mock.calls.length;
    const write = push.getMockImplementation()!;
    push.mockImplementationOnce(async () => {
      getRepositoryTestGitHubApi().bumpHeadOidExternally();
      return { status: 'head-conflict', commitOid: null, blobShas: {} };
    });
    push.mockImplementation(write);

    await repository.flushPending();

    expect(push.mock.calls.length - baseline).toBe(2);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('replans when another writer advances the ref during push', async () => {
    const { repository } = buildRepository('git-push-ref-conflict');
    await repository.initialize();
    await repository.createFile('Retry', 'mp4', null, new Uint8Array([1]));
    const push = vi.mocked(pushGitHubBatch);
    const baseline = push.mock.calls.length;
    push.mockImplementationOnce(async () => {
      getRepositoryTestGitHubApi().bumpHeadOidExternally();
      return {
        status: 'push-failed',
        commitOid: 'f'.repeat(40),
        blobShas: {},
      };
    });

    await repository.flushPending();

    expect(push.mock.calls.length - baseline).toBe(2);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('keeps a failed push queued and reports only safe metrics', async () => {
    const { remote, repository } = buildRepository('git-failed');
    await repository.initialize();
    const fileId = await repository.createFile(
      'Private import title',
      'mp4',
      null,
      new Uint8Array([1]),
    );
    await repository.flushPending();
    await repository.writeFileBytes(fileId, new Uint8Array(73_873_604));
    const pushCount = vi.mocked(pushGitHubBatch).mock.calls.length;
    vi.mocked(pushGitHubBatch).mockRejectedValue(new Error('secret token'));

    await expect(repository.flushPending()).rejects.toThrow(
      'GitHub Git push failed (upload)',
    );

    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBeGreaterThan(
      0,
    );
    expect(vi.mocked(pushGitHubBatch).mock.calls.length - pushCount).toBe(1);
    const failure = vi
      .mocked(trackEvent)
      .mock.calls.filter(([event]) => event === 'sync_failed')
      .at(-1)?.[1];
    expect(failure).toMatchObject({
      github_git_stage: 'upload',
      github_git_additions: 2,
      pending_remote_writes: expect.any(Number),
    });
    expect(failure?.github_git_file_bytes).toBeGreaterThan(73_873_604);
    expect(JSON.stringify(failure)).not.toContain('Private import title');
    expect(JSON.stringify(failure)).not.toContain('secret token');
    expect(repository.getRuntimeStatus().lastError?.message).not.toContain(
      'secret token',
    );
    mockPush();
    await repository.flushPending();
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
    expect((await remote.readFileBytes(fileId))?.byteLength).toBe(73_873_604);
  });

  it('includes only allowlisted native Git failures in diagnostics', async () => {
    const { remote } = buildRepository('git-native-diagnostics');
    await remote.initialize();
    vi.mocked(pushGitHubBatch).mockRejectedValueOnce(
      'Git clone failed (Http/Auth)',
    );

    await expect(
      remote.commitBatch({
        additions: [{ path: 'files/note', contents: new Uint8Array([1]) }],
        deletions: [],
        message: { headline: 'Sync note' },
        expectedHeadOid: await remote.getBranchHeadOid(),
      }),
    ).rejects.toMatchObject({
      message: 'GitHub Git push failed (upload: Git clone failed (Http/Auth))',
      diagnostics: {
        github_git_reason: 'Git clone failed',
        github_git_error_class: 'Http',
        github_git_error_code: 'Auth',
      },
    });
  });

  it('tracks a push rejection and safe REST verification details', async () => {
    const { remote } = buildRepository('git-push-diagnostics');
    await remote.initialize();
    const api = getRepositoryTestGitHubApi();
    api.failNextCompare(503);
    vi.mocked(pushGitHubBatch).mockResolvedValueOnce({
      status: 'push-failed',
      commitOid: 'f'.repeat(40),
      blobShas: {},
      failureReason: 'Git push failed (Net/Timeout)',
    });

    await expect(
      remote.commitBatch({
        additions: [],
        deletions: [{ path: 'files/note' }],
        message: { headline: 'Delete note' },
        expectedHeadOid: await remote.getBranchHeadOid(),
      }),
    ).rejects.toMatchObject({
      diagnostics: {
        github_git_stage: 'verify',
        github_git_reason: 'Git push failed',
        github_git_error_class: 'Net',
        github_git_error_code: 'Timeout',
        github_rest_status: 503,
        github_request_id: 'rest-test-id',
      },
    });
  });

  it('does not push twice when the response is lost after a successful write', async () => {
    const { remote, repository } = buildRepository('git-ambiguous');
    await repository.initialize();
    const bytes = new Uint8Array(73_873_604);
    bytes[0] = 42;
    const fileId = await repository.createFile(
      'Large import',
      'mp4',
      null,
      new Uint8Array([1]),
    );
    await repository.flushPending();
    await repository.writeFileBytes(fileId, bytes);
    const api = getRepositoryTestGitHubApi();
    const push = vi.mocked(pushGitHubBatch);
    const baseline = push.mock.calls.length;
    push.mockImplementationOnce(async (_config, input) => {
      api.applyGitPush(input.additions, input.deletions, input.expectedHeadOid);
      throw new Error('response lost');
    });

    await expect(repository.flushPending()).rejects.toThrow(
      'GitHub Git push failed',
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBeGreaterThan(
      0,
    );
    await repository.flushPending();

    const path = getStoredFilePath({ id: fileId, fileType: 'mp4' });
    expect(push.mock.calls.length - baseline).toBe(1);
    expect(
      push.mock.calls[baseline]?.[1].additions.some(
        (addition) => addition.path === path,
      ),
    ).toBe(true);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
    expect((await remote.readFileBytes(fileId))?.byteLength).toBe(bytes.length);
  });

  it('does not create a duplicate whole-queue commit after losing its response', async () => {
    const { remote, repository } = buildRepository('git-ambiguous-queue');
    await repository.initialize();
    await repository.createFile('First', 'mp4', null, new Uint8Array([1]));
    await repository.createFile('Second', 'mp4', null, new Uint8Array([2]));
    const api = getRepositoryTestGitHubApi();
    const push = vi.mocked(pushGitHubBatch);
    const baseline = push.mock.calls.length;
    push.mockImplementationOnce(async (_config, input) => {
      api.applyGitPush(input.additions, input.deletions, input.expectedHeadOid);
      throw new Error('response lost');
    });

    await expect(repository.flushPending()).rejects.toThrow(BatchUnknownError);
    const committedHead = await remote.getBranchHeadOid();
    await repository.flushPending();

    expect(push.mock.calls.length - baseline).toBe(2);
    expect(await remote.getBranchHeadOid()).toBe(committedHead);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('accepts a push that succeeded but returned a failed response', async () => {
    const { repository } = buildRepository('git-push-response-lost');
    await repository.initialize();
    await repository.createFile('Note', 'mp4', null, new Uint8Array([1]));
    vi.mocked(pushGitHubBatch).mockImplementationOnce(
      async (_config, input) => ({
        ...getRepositoryTestGitHubApi().applyGitPush(
          input.additions,
          input.deletions,
          input.expectedHeadOid,
        ),
        status: 'push-failed',
      }),
    );

    await repository.flushPending();

    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('commits 105 queued files, including a large file, in one push', async () => {
    const { remote, repository } = buildRepository('git-large-file');
    await repository.initialize();
    const baseline = vi.mocked(pushGitHubBatch).mock.calls.length;
    const bytes = new Uint8Array(73_873_604);
    bytes[0] = 42;
    bytes[bytes.length - 1] = 99;
    const fileId = await repository.createFile(
      'Large recording.mp4',
      'mp4',
      null,
      bytes,
    );
    for (let i = 0; i < 104; i++) {
      await repository.createFile(
        `small-${i}`,
        'mp4',
        null,
        new Uint8Array([i]),
      );
    }

    await repository.flushPending();

    expect(vi.mocked(pushGitHubBatch).mock.calls.length - baseline).toBe(1);
    const path = getStoredFilePath({ id: fileId, fileType: 'mp4' });
    const api = getRepositoryTestGitHubApi();
    expect(api.readBytes(path)?.byteLength).toBe(bytes.byteLength);
    expect(api.readBytes(path)?.[0]).toBe(42);
    expect((await remote.readFileBytes(fileId))?.[bytes.length - 1]).toBe(99);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('retries a failed whole-queue commit after restart', async () => {
    const suffix = 'git-restart';
    const { repository } = buildRepository(suffix);
    await repository.initialize();
    for (let i = 0; i < 25; i++) {
      await repository.createFile(
        `note-${i}`,
        'mp4',
        null,
        new Uint8Array([i]),
      );
    }
    const push = vi.mocked(pushGitHubBatch);
    const baseline = push.mock.calls.length;
    push.mockRejectedValueOnce(new Error('interrupted'));

    await expect(repository.flushPending()).rejects.toThrow(
      'GitHub Git push failed',
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBeGreaterThan(
      0,
    );
    expect(push.mock.calls.length - baseline).toBe(1);
    mockPush();
    const reopened = buildRepository(suffix).repository;
    await reopened.initialize();
    await reopened.flushPending();

    expect(reopened.getRuntimeStatus().pendingRemoteWrites).toBe(0);
    expect(push.mock.calls.length - baseline).toBe(2);
  });

  it('does not export cached files while planning a batch', async () => {
    const { cache, repository } = buildRepository('git-manifest-only');
    await repository.initialize();
    const exportSnapshot = vi.spyOn(cache, 'exportSnapshot');
    await repository.createFile(
      'Note',
      'mcanvas',
      null,
      createNoteState('content').update,
    );
    await repository.flushPending();
    expect(exportSnapshot).not.toHaveBeenCalled();
  });

  it('keeps sync behind an active bulk import', async () => {
    const { repository } = buildRepository('git-import-lock');
    await repository.initialize();
    const baseline = vi.mocked(pushGitHubBatch).mock.calls.length;
    let releaseImport: (() => void) | undefined;
    const importGate = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    let importStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      importStarted = resolve;
    });
    const importPromise = repository.batchManifestWrites(async () => {
      await repository.createFile('First', 'mcanvas', null);
      importStarted?.();
      await importGate;
      await repository.createFile('Second', 'mcanvas', null);
    });
    await started;
    const flushPromise = repository.flushPending();
    await Promise.resolve();
    expect(vi.mocked(pushGitHubBatch).mock.calls.length).toBe(baseline);
    releaseImport?.();
    await importPromise;
    await flushPromise;
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
    expect(vi.mocked(pushGitHubBatch).mock.calls.length).toBeGreaterThan(
      baseline,
    );
  });

  it('creates a conflict copy after another device changed raw file bytes', async () => {
    const { remote, repository } = buildRepository('git-raw-conflict');
    await repository.initialize();
    const fileId = await repository.createFile(
      'Clip.mp4',
      'mp4',
      null,
      new Uint8Array([1]),
    );
    await repository.flushPending();
    await remote.writeFileBytes(fileId, new Uint8Array([7, 8, 9]));
    await repository.writeFileBytes(fileId, new Uint8Array([4, 5, 6]));
    await repository.flushPending();

    const [, files] = await repository.listDirectory(null);
    expect(files.some((file) => file.name !== 'Clip.mp4')).toBe(true);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('updates the manifest modified time with a canvas batch', async () => {
    const { remote, repository } = buildRepository('git-canvas-manifest');
    await repository.initialize();
    const fileId = await repository.createFile('Linked note', 'mcanvas', null);
    await repository.flushPending();
    const before = await remote.getNode(fileId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const note = createNoteState('updated');
    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });
    await repository.flushPending();
    const after = await remote.getNode(fileId);
    expect(before?.type).toBe('file');
    expect(after?.type).toBe('file');
    if (before?.type === 'file' && after?.type === 'file') {
      expect(after.modifiedAt).toBeGreaterThan(before.modifiedAt);
    }
  });

  it('keeps an ambiguous canvas update queued until remote state is known', async () => {
    const { repository } = buildRepository('git-canvas-unknown');
    await repository.initialize();
    const fileId = await repository.createFile('Imported PDF', 'mcanvas', null);
    await repository.flushPending();
    const doc = new Y.Doc();
    doc.getMap('pdf').set('bytes', new Uint8Array(1024));
    await repository.pushUpdates(fileId, Y.encodeStateAsUpdate(doc), {
      baseRevision: null,
      localStateVector: Y.encodeStateVector(doc),
    });
    vi.mocked(pushGitHubBatch).mockRejectedValueOnce(
      new Error('connection closed'),
    );
    await expect(repository.flushPending()).rejects.toThrow(BatchUnknownError);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(1);
    await repository.flushPending();
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });
});
