import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackEvent } from '@/lib/analytics';
import {
  createNoteState,
  getRepositoryTestGitHubApi,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { BatchUnknownError } from './batch';
import { CachedRepository } from './cached';
import { GitHubRepository } from './github';
import { LocalRepository } from './local';

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

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

describe('CachedRepository batched flush via GitHub GraphQL', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
    vi.mocked(trackEvent).mockClear();
  });

  it('drains all pending ops in a single GraphQL commit', async () => {
    const { repository } = buildRepository('batch-happy-path');
    await repository.initialize();

    const api = getRepositoryTestGitHubApi();
    const baselinePuts = api.putCallCount;
    const baselineGraphql = api.graphqlCallCount;

    const fileIdA = await repository.createFile('Note A', 'mcanvas', null);
    const fileIdB = await repository.createFile('Note B', 'mcanvas', null);
    const noteA = createNoteState('alpha content');
    const noteB = createNoteState('beta content');

    await repository.pushUpdates(fileIdA, noteA.update, {
      baseRevision: null,
      localStateVector: noteA.stateVector,
    });
    await repository.pushUpdates(fileIdB, noteB.update, {
      baseRevision: null,
      localStateVector: noteB.stateVector,
    });

    await repository.flushPending();

    expect(api.graphqlCallCount - baselineGraphql).toBe(1);
    expect(api.putCallCount).toBe(baselinePuts);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('retries the batch once on a HEAD OID conflict and succeeds', async () => {
    const { repository } = buildRepository('batch-conflict-retry');
    await repository.initialize();

    const api = getRepositoryTestGitHubApi();
    const baselineGraphql = api.graphqlCallCount;
    const baselinePuts = api.putCallCount;

    const fileId = await repository.createFile('Retry note', 'mcanvas', null);
    const note = createNoteState('retry content');
    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    api.failNextGraphQL('head-conflict');
    await repository.flushPending();

    expect(api.graphqlCallCount - baselineGraphql).toBe(2);
    expect(api.putCallCount).toBe(baselinePuts);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('falls back to per-op REST after two consecutive HEAD OID conflicts', async () => {
    const { repository } = buildRepository('batch-conflict-fallback');
    await repository.initialize();

    const api = getRepositoryTestGitHubApi();
    const baselineGraphql = api.graphqlCallCount;
    const baselinePuts = api.putCallCount;

    const fileId = await repository.createFile(
      'Fallback note',
      'mcanvas',
      null,
    );
    const note = createNoteState('fallback content');
    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    api.failNextGraphQL('head-conflict');
    api.failNextGraphQL('head-conflict');
    await repository.flushPending();

    expect(api.graphqlCallCount - baselineGraphql).toBe(2);
    expect(api.putCallCount).toBeGreaterThan(baselinePuts);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('retries smaller GraphQL prefixes after a network failure', async () => {
    const { repository } = buildRepository('batch-network-fallback');
    await repository.initialize();

    const api = getRepositoryTestGitHubApi();
    const baselineGraphql = api.graphqlCallCount;
    const baselinePuts = api.putCallCount;

    const fileId = await repository.createFile('Net note', 'mcanvas', null);
    const note = createNoteState('net content');
    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    api.failNextGraphQL('network');
    await repository.flushPending();

    expect(api.graphqlCallCount - baselineGraphql).toBe(3);
    expect(api.putCallCount).toBe(baselinePuts);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('tracks safe request diagnostics when a single-change GraphQL commit fails', async () => {
    const { repository } = buildRepository('batch-failure-diagnostics');
    await repository.initialize();
    const api = getRepositoryTestGitHubApi();

    const fileId = await repository.createFile(
      'Private note title from GitHub',
      'mp4',
      null,
      new Uint8Array([1, 2, 3]),
    );
    await repository.flushPending();
    vi.mocked(trackEvent).mockClear();
    await repository.writeFileBytes(fileId, new Uint8Array([4, 5, 6, 7]));
    api.failNextGraphQL('http-499');

    await expect(repository.flushPending()).rejects.toThrow(
      'GitHub GraphQL request failed (499)',
    );

    const failure = vi
      .mocked(trackEvent)
      .mock.calls.filter(([event]) => event === 'sync_failed')
      .at(-1)?.[1];
    expect(failure).toMatchObject({
      error_message: 'GitHub GraphQL request failed (499)',
      pending_remote_writes: 1,
      github_graphql_stage: 'http',
      github_graphql_status: 499,
      github_graphql_content_type: 'application/json',
      github_graphql_additions: 2,
      github_graphql_deletions: 0,
      github_request_id: 'test-request-id',
    });
    expect(failure?.github_graphql_request_chars).toBeGreaterThan(0);
    expect(failure?.github_graphql_file_bytes).toBeGreaterThan(4);
    expect(failure?.github_graphql_response_chars).toBeGreaterThan(0);
    expect(JSON.stringify(failure)).not.toContain('Private note title');
  });

  it('does not create a conflict copy after an ambiguous successful commit', async () => {
    const { remote, repository } = buildRepository('batch-ambiguous-success');
    await repository.initialize();
    const commitBatch = remote.commitBatch.bind(remote);
    let firstCommit = true;
    vi.spyOn(remote, 'commitBatch').mockImplementation(async (input) => {
      const result = await commitBatch(input);
      if (firstCommit) {
        firstCommit = false;
        throw new BatchUnknownError('response lost after commit', null);
      }
      return result;
    });

    const fileId = await repository.createFile(
      'Applied once.bin',
      'mp4',
      null,
      new Uint8Array([4, 5, 6]),
    );
    await repository.flushPending();

    const [, localFiles] = await repository.listDirectory(null);
    const [, remoteFiles] = await remote.listDirectory(null);
    expect(localFiles.map((file) => file.id)).toEqual([fileId]);
    expect(remoteFiles.map((file) => file.id)).toEqual([fileId]);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('chunks a large operation count across commits', async () => {
    const { repository } = buildRepository('batch-large');
    await repository.initialize();

    const api = getRepositoryTestGitHubApi();
    const baselineGraphql = api.graphqlCallCount;

    const bytes = new Uint8Array([1, 2, 3]);
    for (let i = 0; i < 55; i++) {
      await repository.createFile(`raw-${i}.bin`, 'mp4', null, bytes);
    }

    await repository.flushPending();

    expect(api.graphqlCallCount - baselineGraphql).toBe(3);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('resumes from the first uncommitted chunk after restart', async () => {
    const suffix = 'batch-restart';
    const { remote, repository } = buildRepository(suffix);
    await repository.initialize();
    const bytes = new Uint8Array([1, 2, 3]);
    for (let i = 0; i < 25; i++) {
      await repository.createFile(`restart-${i}.bin`, 'mp4', null, bytes);
    }

    const commitBatch = remote.commitBatch.bind(remote);
    let commitAttempts = 0;
    const interruptedCommit = vi
      .spyOn(remote, 'commitBatch')
      .mockImplementation(async (input) => {
        commitAttempts += 1;
        if (commitAttempts > 1) {
          throw new BatchUnknownError('simulated interruption', null);
        }
        return commitBatch(input);
      });

    await expect(repository.flushPending()).rejects.toThrow(
      'simulated interruption',
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(10);
    interruptedCommit.mockRestore();
    const tarballsBeforeRestart =
      getRepositoryTestGitHubApi().tarballFetchCount;

    const reopened = buildRepository(suffix).repository;
    await reopened.initialize();
    expect(getRepositoryTestGitHubApi().tarballFetchCount).toBe(
      tarballsBeforeRestart,
    );
    await reopened.flushPending();

    expect(reopened.getRuntimeStatus().pendingRemoteWrites).toBe(0);
    expect(getRepositoryTestGitHubApi().graphqlCallCount).toBeGreaterThan(1);
  });

  it('chunks batches by raw byte size', async () => {
    const { repository } = buildRepository('batch-byte-limit');
    await repository.initialize();

    const api = getRepositoryTestGitHubApi();
    const baselineGraphql = api.graphqlCallCount;
    const bytes = new Uint8Array(5 * 1024 * 1024);

    for (let i = 0; i < 3; i++) {
      bytes[0] = i;
      await repository.createFile(`large-${i}.bin`, 'mp4', null, bytes);
    }

    await repository.flushPending();

    expect(api.graphqlCallCount - baselineGraphql).toBe(3);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('does not export every cached file while planning a batch', async () => {
    const { cache, repository } = buildRepository('batch-manifest-only');
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
    const { repository } = buildRepository('batch-import-lock');
    await repository.initialize();
    const api = getRepositoryTestGitHubApi();
    const baselineGraphql = api.graphqlCallCount;
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

    expect(api.graphqlCallCount).toBe(baselineGraphql);

    releaseImport?.();
    await importPromise;
    await flushPromise;

    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
    expect(api.graphqlCallCount).toBeGreaterThan(baselineGraphql);
  });

  it('does not queue remote pulls for files created inside a bulk import', async () => {
    const { remote, repository } = buildRepository('batch-import-pulls');
    await repository.initialize();
    const pullUpdates = vi.spyOn(remote, 'pullUpdates');

    await repository.batchManifestWrites(async () => {
      const fileId = await repository.createFile(
        'Imported note',
        'mcanvas',
        null,
      );
      const session = await repository.openSession(fileId, {
        skipRemotePull: true,
      });
      session.ydoc.doc.getText('content').insert(0, 'imported');
      await session.save();
      await session.close();
    });
    await repository.flushPending();

    expect(pullUpdates).not.toHaveBeenCalled();
  });

  it('does not sync partial state from a failed bulk import', async () => {
    const { repository } = buildRepository('batch-import-failure');
    await repository.initialize();
    const api = getRepositoryTestGitHubApi();
    const baselineGraphql = api.graphqlCallCount;

    await expect(
      repository.batchManifestWrites(async () => {
        await repository.createFile('Partial note', 'mcanvas', null);
        throw new Error('import failed');
      }),
    ).rejects.toThrow('import failed');
    await Promise.resolve();

    expect(api.graphqlCallCount).toBe(baselineGraphql);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('aborts batch and uses REST when a raw-file write has a stale base revision', async () => {
    const { remote, repository } = buildRepository('batch-raw-conflict');
    await repository.initialize();

    const api = getRepositoryTestGitHubApi();

    const fileId = await repository.createFile(
      'Clip.mp4',
      'mp4',
      null,
      new Uint8Array([1, 2, 3]),
    );
    await repository.flushPending();

    // Simulate another writer changing the raw file on the remote so the local
    // baseFileRevision the next write captures will be stale.
    await remote.writeFileBytes(fileId, new Uint8Array([7, 8, 9]));

    const baselineGraphql = api.graphqlCallCount;
    const baselinePuts = api.putCallCount;

    await repository.writeFileBytes(fileId, new Uint8Array([4, 5, 6]));
    await repository.flushPending();

    expect(api.graphqlCallCount).toBe(baselineGraphql);
    expect(api.putCallCount).toBeGreaterThan(baselinePuts);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);

    const [, files] = await repository.listDirectory(null);
    const conflictCopy = files.find((f) => f.name !== 'Clip.mp4');
    expect(conflictCopy).toBeDefined();
  });

  it('updates manifest modifiedAt for canvas pushes routed through the batch', async () => {
    const { remote, repository } = buildRepository('batch-canvas-manifest');
    await repository.initialize();

    const fileId = await repository.createFile('Linked note', 'mcanvas', null);
    await repository.flushPending();

    const remoteNodeBefore = await remote.getNode(fileId);
    expect(remoteNodeBefore?.type).toBe('file');
    const modifiedAtBefore =
      remoteNodeBefore && remoteNodeBefore.type === 'file'
        ? remoteNodeBefore.modifiedAt
        : 0;

    const api = getRepositoryTestGitHubApi();
    const baselineGraphql = api.graphqlCallCount;

    // Advance the wall clock by sleeping enough that Date.now() must move
    // forward; modifiedAt is timestamp-based.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const note = createNoteState('updated content');
    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });
    await repository.flushPending();

    expect(api.graphqlCallCount - baselineGraphql).toBe(1);

    const remoteNodeAfter = await remote.getNode(fileId);
    expect(remoteNodeAfter?.type).toBe('file');
    const modifiedAtAfter =
      remoteNodeAfter && remoteNodeAfter.type === 'file'
        ? remoteNodeAfter.modifiedAt
        : 0;
    expect(modifiedAtAfter).toBeGreaterThan(modifiedAtBefore);
  });
});
