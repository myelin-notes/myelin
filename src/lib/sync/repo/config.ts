import type { YjsSyncTarget } from '../types';
import type { Repository } from './types';

export type RepositoryConfig =
  | { kind: 'local' }
  | {
      kind: 'github';
      owner: string;
      repo: string;
      branch?: string;
      credentialId: string;
    };

function normalizeStorageKeyPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_') || 'default';
}

/**
 * Stable, filesystem-safe key identifying a repository's local storage. GitHub
 * repos cache their files under `repositories/github/<key>` (see factory.ts),
 * and the note-index namespaces its artifacts under `NoteIndex/<key>/` so each
 * repository's index is isolated. The same owner/repo/branch always maps to the
 * same key regardless of credential, matching the shared on-disk cache.
 */
export function getRepositoryStorageKey(config: RepositoryConfig): string {
  switch (config.kind) {
    case 'local':
      return 'local';
    case 'github':
      return [
        normalizeStorageKeyPart(config.owner),
        normalizeStorageKeyPart(config.repo),
        normalizeStorageKeyPart(config.branch ?? 'main'),
      ].join('__');
  }
}

export interface RepositoryLifecycle {
  initialize(): Promise<void>;
  refresh(): Promise<void>;
  flushPending(): Promise<void>;
  dispose(): Promise<void>;
}

export interface RepositoryRuntimeStatus {
  online: boolean;
  pendingRemoteWrites: number;
  lastRemoteSyncAt: number | null;
  lastError: Error | null;
}

export interface RepositoryStatusSource {
  getRuntimeStatus(): RepositoryRuntimeStatus;
  subscribeStatus(
    listener: (status: RepositoryRuntimeStatus) => void,
  ): () => void;
}

export type ActiveRepository = Repository &
  YjsSyncTarget &
  RepositoryLifecycle &
  RepositoryStatusSource;

export const DEFAULT_REPOSITORY_CONFIG: RepositoryConfig = { kind: 'local' };
