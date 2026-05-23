import { beforeEach, describe, expect, it } from 'vitest';
import {
  createNoteState,
  getRepositoryTestGitHubApi,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { CachedRepository } from './cached';
import { GitHubRepository } from './github';
import { LocalRepository } from './local';

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

  it('falls back to per-op REST immediately on a network failure', async () => {
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

    expect(api.graphqlCallCount - baselineGraphql).toBe(1);
    expect(api.putCallCount).toBeGreaterThan(baselinePuts);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('chunks a flush exceeding the per-commit file limit', async () => {
    const { repository } = buildRepository('batch-chunking');
    await repository.initialize();

    const api = getRepositoryTestGitHubApi();
    const baselineGraphql = api.graphqlCallCount;

    const bytes = new Uint8Array([1, 2, 3]);
    for (let i = 0; i < 55; i++) {
      await repository.createFile(`raw-${i}.bin`, 'mp4', null, bytes);
    }

    await repository.flushPending();

    expect(api.graphqlCallCount - baselineGraphql).toBe(2);
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
