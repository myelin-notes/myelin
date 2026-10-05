import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackEvent } from '@/lib/analytics';
import { createSyncCompletionTracker } from './analytics';
import type { RepositoryConfig } from './repo/config';
import type { RepositoryStatus } from './repo-context';

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

let now = 0;

function status(patch: Partial<RepositoryStatus> = {}): RepositoryStatus {
  return {
    config: {
      kind: 'github',
      owner: 'owner',
      repo: 'repo',
      credentialId: 'default',
    },
    initializing: false,
    online: true,
    pendingRemoteWrites: 0,
    lastRemoteSyncAt: 1,
    lastError: null,
    dataVersion: 0,
    ...patch,
  };
}

beforeEach(() => {
  now = 0;
  vi.mocked(trackEvent).mockClear();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sync completion analytics', () => {
  const configs: RepositoryConfig[] = [
    { kind: 'local' },
    { kind: 'github', owner: 'owner', repo: 'repo', credentialId: 'default' },
    {
      kind: 'google-drive',
      folderName: 'Myelin',
      folderId: 'folder-id',
      credentialId: 'default',
    },
  ];

  it.each(configs)('tracks loading completion for $kind', (config) => {
    const observe = createSyncCompletionTracker();
    observe(status({ config, initializing: true, lastRemoteSyncAt: null }));
    now = 125;
    observe(status({ config, initializing: true }));
    expect(trackEvent).not.toHaveBeenCalled();
    now = 200;
    observe(status({ config }));

    expect(trackEvent).toHaveBeenCalledExactlyOnceWith('sync_completed', {
      repository_kind: config.kind,
      from_state: 'loading',
      duration_ms: 200,
      max_pending_remote_writes: 0,
      had_error: false,
      was_offline: false,
    });
  });

  it('times each pending cycle from its first queued write and ignores idle updates', () => {
    const observe = createSyncCompletionTracker();
    observe(status());
    now = 100;
    observe(status({ pendingRemoteWrites: 1 }));
    now = 200;
    observe(status({ pendingRemoteWrites: 5 }));
    now = 300;
    observe(status({ pendingRemoteWrites: 2 }));
    now = 400;
    observe(status());
    observe(status({ dataVersion: 4, lastRemoteSyncAt: 2 }));

    expect(trackEvent).toHaveBeenCalledExactlyOnceWith('sync_completed', {
      repository_kind: 'github',
      from_state: 'pending',
      duration_ms: 300,
      max_pending_remote_writes: 5,
      had_error: false,
      was_offline: false,
    });

    now = 600;
    observe(status({ pendingRemoteWrites: 1 }));
    now = 650;
    observe(status());
    expect(trackEvent).toHaveBeenCalledTimes(2);
    expect(trackEvent).toHaveBeenLastCalledWith(
      'sync_completed',
      expect.objectContaining({
        duration_ms: 50,
        max_pending_remote_writes: 1,
      }),
    );
  });

  it('includes pending work and retry time in a loading cycle', () => {
    const observe = createSyncCompletionTracker();
    observe(status({ initializing: true, lastRemoteSyncAt: null }));
    now = 100;
    observe(status({ pendingRemoteWrites: 3, lastRemoteSyncAt: null }));
    now = 200;
    observe(
      status({
        pendingRemoteWrites: 3,
        online: false,
        lastError: new Error('private diagnostic'),
        lastRemoteSyncAt: null,
      }),
    );
    now = 300;
    observe(status({ online: false }));
    observe(status({ lastError: new Error('still failing') }));
    expect(trackEvent).not.toHaveBeenCalled();
    now = 1000;
    observe(status());

    expect(trackEvent).toHaveBeenCalledExactlyOnceWith('sync_completed', {
      repository_kind: 'github',
      from_state: 'loading',
      duration_ms: 1000,
      max_pending_remote_writes: 3,
      had_error: true,
      was_offline: true,
    });
  });

  it('requires confirmation of a remote sync, but lets local loading complete', () => {
    const observeRemote = createSyncCompletionTracker();
    observeRemote(status({ initializing: true, lastRemoteSyncAt: null }));
    now = 100;
    observeRemote(status({ lastRemoteSyncAt: null }));
    expect(trackEvent).not.toHaveBeenCalled();

    const observeLocal = createSyncCompletionTracker();
    const config: RepositoryConfig = { kind: 'local' };
    observeLocal(
      status({ config, initializing: true, lastRemoteSyncAt: null }),
    );
    now = 150;
    observeLocal(status({ config, lastRemoteSyncAt: null }));
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith(
      'sync_completed',
      expect.objectContaining({ repository_kind: 'local', duration_ms: 50 }),
    );

    now = 250;
    observeRemote(status());
    expect(trackEvent).toHaveBeenLastCalledWith(
      'sync_completed',
      expect.objectContaining({ repository_kind: 'github', duration_ms: 250 }),
    );
  });
});
