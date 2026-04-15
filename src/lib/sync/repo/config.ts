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

export type ActiveRepository = Repository & YjsSyncTarget & RepositoryLifecycle;

export const DEFAULT_REPOSITORY_CONFIG: RepositoryConfig = { kind: 'local' };
