import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getPlatform } from '@myelin/editor/platform';
import { Logger } from '@myelin/shared/logger';
import type { RepositoryConfig, RepositoryRuntimeStatus } from './repo/config';
import {
  type CredentialChange,
  subscribeCredentialChanges,
} from './repo/credential-vault';
import { createRepository } from './repo/factory';
import { credentialTokenKey } from './repo/oauth/client';
import { isRepositoryFullyConfigured } from './repo/readiness';
import {
  getRepositoryConfigIdentity,
  getRepositoryStorageKey,
} from './repo/repository-backends';
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
const READINESS_RETRY_DELAY_MS = 30_000;

function credentialChangeAffectsConfig(
  change: CredentialChange,
  config: RepositoryConfig,
): boolean {
  if (config.kind === 'local') {
    return false;
  }

  return (
    change.clientName === config.kind &&
    change.key === credentialTokenKey(config.credentialId)
  );
}

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
        getRepositoryConfigIdentity(current) ===
        getRepositoryConfigIdentity(nextConfig)
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

  useEffect(
    () =>
      subscribeCredentialChanges((change) => {
        setResolvedConfig((current) =>
          credentialChangeAffectsConfig(change, current)
            ? { ...current }
            : current,
        );
      }),
    [],
  );

  useEffect(() => {
    setStatus(
      mergeRuntimeStatus(
        createRepositoryStatus(resolvedConfig),
        repository.getRuntimeStatus(),
      ),
    );

    let disposed = false;
    let readinessRetryTimer: number | null = null;
    const unsubscribeStatus = repository.subscribeStatus((runtimeStatus) => {
      if (disposed) {
        return;
      }

      setStatus((current) => mergeRuntimeStatus(current, runtimeStatus));
    });

    const initialize = async (): Promise<void> => {
      try {
        const ready = await isRepositoryFullyConfigured(resolvedConfig);
        if (disposed) {
          return;
        }

        if (!ready) {
          setStatus((current) => ({
            ...current,
            initializing: false,
            online: false,
            lastError: null,
          }));
          if (typeof window !== 'undefined') {
            readinessRetryTimer = window.setTimeout(() => {
              void initialize();
            }, READINESS_RETRY_DELAY_MS);
          }
          return;
        }

        setStatus((current) => ({ ...current, initializing: true }));
        await repository.initialize();
        if (disposed) {
          return;
        }

        setStatus((current) => ({
          ...current,
          initializing: false,
        }));

        // Hydrate the search corpus and backfill any unindexed notes in the
        // background. The index cache is namespaced per repository; Rust skips
        // notes whose content hash is unchanged. Both engines are optional
        // platform capabilities; absence means no indexing on this client.
        const { noteIndex, handwriting } = getPlatform();
        handwriting?.init(getRepositoryStorageKey(resolvedConfig));
        if (noteIndex || handwriting) {
          void (
            noteIndex?.init(getRepositoryStorageKey(resolvedConfig)) ??
            Promise.resolve()
          )
            .then(() => repository.listIndexBackfillItems())
            .then((items) => {
              // A repo switch may have run cleanup (reset + next init) while
              // this chain was resolving; bail so we don't backfill the
              // previous repo's items under the now-current repo.
              if (disposed) {
                return;
              }
              noteIndex?.startBackfill(items);
              handwriting?.startBackfill(items);
            })
            .catch((error) => {
              logger.error('Failed to start note-index backfill', error);
            });
        }
      } catch (error) {
        if (disposed) {
          return;
        }

        setStatus((current) => ({
          ...current,
          initializing: false,
          lastError: error instanceof Error ? error : new Error(String(error)),
        }));
      }
    };

    void initialize();

    return () => {
      disposed = true;
      if (readinessRetryTimer !== null) {
        window.clearTimeout(readinessRetryTimer);
      }
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
