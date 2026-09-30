import { trackEvent } from '@/lib/analytics';
import type { RepositoryStatus } from './repo-context';

interface SyncCycle {
  fromState: 'loading' | 'pending';
  startedAt: number;
  maxPendingRemoteWrites: number;
  hadError: boolean;
  wasOffline: boolean;
}

export function createSyncCompletionTracker(): (
  status: RepositoryStatus,
) => void {
  let cycle: SyncCycle | null = null;

  return (status) => {
    if (!cycle && (status.initializing || status.pendingRemoteWrites > 0)) {
      cycle = {
        fromState: status.initializing ? 'loading' : 'pending',
        startedAt: performance.now(),
        maxPendingRemoteWrites: 0,
        hadError: false,
        wasOffline: false,
      };
    }
    if (!cycle) {
      return;
    }

    cycle.maxPendingRemoteWrites = Math.max(
      cycle.maxPendingRemoteWrites,
      status.pendingRemoteWrites,
    );
    cycle.hadError ||= status.lastError !== null;
    cycle.wasOffline ||= !status.online;

    if (
      status.initializing ||
      status.pendingRemoteWrites > 0 ||
      !status.online ||
      status.lastError ||
      (status.config.kind !== 'local' && status.lastRemoteSyncAt === null)
    ) {
      return;
    }

    const completed = cycle;
    cycle = null;
    trackEvent('sync_completed', {
      repository_kind: status.config.kind,
      from_state: completed.fromState,
      duration_ms: performance.now() - completed.startedAt,
      max_pending_remote_writes: completed.maxPendingRemoteWrites,
      had_error: completed.hadError,
      was_offline: completed.wasOffline,
    });
  };
}
