import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Logger } from '@/lib/logger';
import { getPlatform } from '@/platform';
import {
  getRepositoryStorageKey,
  type RepositoryConfig,
  type RepositoryRuntimeStatus,
} from './repo/config';
import { createRepository } from './repo/factory';
import {
  getRepositoryConfig,
  subscribeRepositoryConfig,
} from './repo/repository-settings';
import {
  RepositoryContext,
  type RepositoryContextValue,
  type RepositoryStatus,
} from './repo-context';
import { RepositoryShutdownGate } from './shutdown-gate';

const logger = new Logger('RepositoryProvider');

function createRepositoryStatus(config: RepositoryConfig): RepositoryStatus {
  return {
    config,
    initializing: true,
    online: true,
    pendingRemoteWrites: 0,
    lastRemoteSyncAt: null,
    lastError: null,
    dataVersion: 0,
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
    dataVersion: runtimeStatus.dataVersion,
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
  const setResolvedConfigIfChanged = useCallback(
    (nextConfig: RepositoryConfig) => {
      setResolvedConfig((current) =>
        getConfigKey(current) === getConfigKey(nextConfig)
          ? current
          : nextConfig,
      );
    },
    [],
  );
  const repository = useMemo(
    () => createRepository(resolvedConfig),
    [resolvedConfig],
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
      setResolvedConfigIfChanged(config);
      return;
    }

    setResolvedConfigIfChanged(getRepositoryConfig());
    return subscribeRepositoryConfig(setResolvedConfigIfChanged);
  }, [config, setResolvedConfigIfChanged]);

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

        // Hydrate the search corpus from the artifacts already on disk. The
        // index cache is namespaced per repository. Both engines are optional
        // platform capabilities; absence means no indexing on this client.
        //
        // TEMPORARY (iOS frame-rate probe): the startup backfill is disabled
        // while we measure whether the Rust indexing work is what pins an old
        // iPad's frame rate. It used to chain
        // `repository.listIndexBackfillItems()` off this init and hand the
        // items to `noteIndex.startBackfill()` / `handwriting.startBackfill()`
        // (guarding on `disposed` first, so a repo switch mid-chain could not
        // backfill the previous repo's items under the current one). Restore
        // that chain once the measurement is done.
        const { noteIndex, handwriting } = getPlatform();
        handwriting?.init(getRepositoryStorageKey(resolvedConfig));
        void noteIndex
          ?.init(getRepositoryStorageKey(resolvedConfig))
          .catch((error) => {
            logger.error('Failed to hydrate note index', error);
          });
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
      // Drop the previous repo's search corpus so it can't leak into the next.
      getPlatform().noteIndex?.reset();
      getPlatform().handwriting?.reset();
      void repository.dispose().catch((error) => {
        logger.error('Failed to dispose repository', error);
      });
    };
  }, [resolvedConfig, repository]);

  return (
    <RepositoryContext.Provider value={contextValue}>
      <RepositoryShutdownGate />
      {children}
    </RepositoryContext.Provider>
  );
}
