import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ActiveRepository, RepositoryConfig } from './repo/config';
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

function isTauriWindowAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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

  useEffect(() => {
    if (config) {
      setResolvedConfig(config);
      return;
    }

    setResolvedConfig(getRepositoryConfig());
    return subscribeRepositoryConfig(setResolvedConfig);
  }, [config]);

  useEffect(() => {
    setStatus(createRepositoryStatus(resolvedConfig));

    let disposed = false;

    void repository
      .initialize()
      .then(() => {
        if (disposed) {
          return;
        }

        setStatus((current) => ({
          ...current,
          initializing: false,
          lastError: null,
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
      void repository.dispose().catch(console.error);
    };
  }, [configKey, resolvedConfig, repository]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      void repository.flushPending().catch(console.error);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    let closing = false;
    let unlistenPromise: Promise<() => void> | null = null;

    if (isTauriWindowAvailable()) {
      const currentWindow = getCurrentWindow();
      unlistenPromise = currentWindow.onCloseRequested(async (event) => {
        if (closing) {
          return;
        }

        closing = true;
        event.preventDefault();

        try {
          await repository.flushPending();
        } catch (error) {
          console.error(error);
        }

        await currentWindow.destroy();
      });
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (unlistenPromise) {
        void unlistenPromise.then((unlisten) => {
          unlisten();
        });
      }
    };
  }, [repository]);

  return (
    <RepositoryContext.Provider value={{ repository, status }}>
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
