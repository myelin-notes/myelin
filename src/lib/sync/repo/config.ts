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
