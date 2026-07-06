/**
 * The repository React context and its consumer hooks, split from the
 * provider (`context.tsx`) so editor code can read the active repository
 * without pulling in the repository implementations the provider constructs.
 */

import { createContext, useContext } from 'react';
import type { ActiveRepository, RepositoryConfig } from './repo/config';

export interface RepositoryStatus {
  config: RepositoryConfig;
  initializing: boolean;
  online: boolean;
  pendingRemoteWrites: number;
  lastRemoteSyncAt: number | null;
  lastError: Error | null;
  /** Bumped on every local repository mutation so views can refresh in sync. */
  dataVersion: number;
}

export interface RepositoryContextValue {
  repository: ActiveRepository;
  status: RepositoryStatus;
}

export const RepositoryContext = createContext<RepositoryContextValue | null>(
  null,
);

export function useRepository(): ActiveRepository {
  const context = useContext(RepositoryContext);
  if (!context) {
    throw new Error('useRepository must be used within a RepositoryProvider.');
  }

  return context.repository;
}

export function useRepositoryStatus(): RepositoryStatus {
  const context = useContext(RepositoryContext);
  if (!context) {
    throw new Error(
      'useRepositoryStatus must be used within a RepositoryProvider.',
    );
  }

  return context.status;
}
