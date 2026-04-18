import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  ActiveRepository,
  RepositoryConfig,
  RepositoryRuntimeStatus,
} from './repo/config';
import { createRepository } from './repo/factory';
import {
  getRepositoryConfig,
  subscribeRepositoryConfig,
} from './repo/repository-settings';

export interface RepositoryStatus {
  config: RepositoryConfig;
  initializing: boolean;
  online: boolean;
  pendingRemoteWrites: number;
  lastRemoteSyncAt: number | null;
  lastError: Error | null;
}

interface RepositoryContextValue {
  repository: ActiveRepository;
  status: RepositoryStatus;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

function createRepositoryStatus(config: RepositoryConfig): RepositoryStatus {
  return {
    config,
    initializing: true,
    online: true,
    pendingRemoteWrites: 0,
    lastRemoteSyncAt: null,
    lastError: null,
  };
}

function mergeRuntimeStatus(
  current: RepositoryStatus,
  runtimeStatus: RepositoryRuntimeStatus,
): RepositoryStatus {
  return {
    ...current,
    online: runtimeStatus.online,
    pendingRemoteWrites: runtimeStatus.pendingRemoteWrites,
    lastRemoteSyncAt: runtimeStatus.lastRemoteSyncAt,
    lastError: runtimeStatus.lastError,
  };
}

function getConfigKey(config: RepositoryConfig): string {
  switch (config.kind) {
    case 'local':
      return 'local';
    case 'github':
      return [
        'github',
        config.owner,
        config.repo,
        config.branch ?? '',
        config.credentialId,
      ].join('\0');
  }
}

export function RepositoryProvider({
  children,
  config,
}: PropsWithChildren<{ config?: RepositoryConfig }>) {
  const [resolvedConfig, setResolvedConfig] = useState<RepositoryConfig>(
    () => config ?? getRepositoryConfig(),
  );
  const configKey = getConfigKey(resolvedConfig);
  const repository = useMemo(
    () => createRepository(resolvedConfig),
    [configKey, resolvedConfig],
  );
  const [status, setStatus] = useState<RepositoryStatus>(() =>
    createRepositoryStatus(resolvedConfig),
  );
  const contextValue = useMemo<RepositoryContextValue>(
    () => ({
      repository,
      status,
    }),
    [repository, status],
  );

  useEffect(() => {
    if (config) {
      setResolvedConfig(config);
      return;
    }

    setResolvedConfig(getRepositoryConfig());
    return subscribeRepositoryConfig(setResolvedConfig);
  }, [config]);

  useEffect(() => {
    setStatus(
      mergeRuntimeStatus(
        createRepositoryStatus(resolvedConfig),
        repository.getRuntimeStatus(),
      ),
    );

    let disposed = false;
    const unsubscribeStatus = repository.subscribeStatus((runtimeStatus) => {
      if (disposed) {
        return;
      }

      setStatus((current) => mergeRuntimeStatus(current, runtimeStatus));
    });

    void repository
      .initialize()
      .then(() => {
        if (disposed) {
          return;
        }

        setStatus((current) => ({
          ...current,
          initializing: false,
        }));
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        setStatus((current) => ({
          ...current,
          initializing: false,
          lastError: error instanceof Error ? error : new Error(String(error)),
        }));
      });

    return () => {
      disposed = true;
      unsubscribeStatus();
      void repository.dispose().catch(console.error);
    };
  }, [configKey, resolvedConfig, repository]);

  return (
    <RepositoryContext.Provider value={contextValue}>
      {children}
    </RepositoryContext.Provider>
  );
}

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
