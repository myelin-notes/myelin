import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
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

interface BeforeShutdownTask {
  run(): Promise<void>;
  shouldBlock(): boolean;
}

interface RepositoryContextValue {
  repository: ActiveRepository;
  status: RepositoryStatus;
  registerBeforeShutdown(task: BeforeShutdownTask): () => void;
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

function isTauriWindowAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function RepositoryProvider({
  children,
  config,
}: PropsWithChildren<{ config?: RepositoryConfig }>) {
  const beforeShutdownTasksRef = useRef(new Set<BeforeShutdownTask>());
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
      registerBeforeShutdown(task) {
        beforeShutdownTasksRef.current.add(task);
        return () => {
          beforeShutdownTasksRef.current.delete(task);
        };
      },
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

  useEffect(() => {
    const runBeforeShutdownTasks = async (tasks?: BeforeShutdownTask[]) => {
      const tasksToRun = tasks ?? Array.from(beforeShutdownTasksRef.current);
      for (const task of tasksToRun) {
        try {
          await task.run();
        } catch (error) {
          console.error(error);
        }
      }
    };

    const handleBeforeUnload = () => {
      void runBeforeShutdownTasks();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    let closing = false;
    let allowNextClose = false;
    let unlistenPromise: Promise<() => void> | null = null;

    if (isTauriWindowAvailable()) {
      const currentWindow = getCurrentWindow();
      unlistenPromise = currentWindow.onCloseRequested(async (event) => {
        if (allowNextClose) {
          allowNextClose = false;
          return;
        }

        if (closing) {
          event.preventDefault();
          return;
        }

        const blockingTasks = Array.from(beforeShutdownTasksRef.current).filter(
          (task) => {
            try {
              return task.shouldBlock();
            } catch (error) {
              console.error(error);
              return true;
            }
          },
        );

        if (blockingTasks.length === 0) {
          return;
        }

        event.preventDefault();
        closing = true;

        try {
          await runBeforeShutdownTasks(blockingTasks);
          allowNextClose = true;
          window.setTimeout(() => {
            void currentWindow.close().catch((error) => {
              console.error(error);
              allowNextClose = false;
              closing = false;
            });
          }, 0);
        } catch (error) {
          console.error(error);
          closing = false;
        }
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

export function useBeforeShutdown(
  task: () => Promise<void>,
  options?: {
    shouldBlock?: () => boolean;
  },
): void {
  const context = useContext(RepositoryContext);
  const taskRef = useRef(task);
  const shouldBlockRef = useRef(options?.shouldBlock ?? (() => true));
  taskRef.current = task;
  shouldBlockRef.current = options?.shouldBlock ?? (() => true);

  useEffect(() => {
    if (!context) {
      throw new Error(
        'useBeforeShutdown must be used within a RepositoryProvider.',
      );
    }

    return context.registerBeforeShutdown({
      run: () => taskRef.current(),
      shouldBlock: () => shouldBlockRef.current(),
    });
  }, [context]);
}
