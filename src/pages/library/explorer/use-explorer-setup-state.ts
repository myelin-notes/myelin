import { useEffect, useState } from 'react';
import type { RepositoryConfig } from '@/lib/sync';
import {
  type ExplorerSetupState,
  getInitialExplorerSetupState,
  resolveExplorerSetupState,
} from './explorer-model';

export function useExplorerSetupState(
  config: RepositoryConfig,
): ExplorerSetupState {
  const [setupState, setSetupState] = useState<ExplorerSetupState>(() =>
    getInitialExplorerSetupState(config),
  );

  useEffect(() => {
    let cancelled = false;
    const initial = getInitialExplorerSetupState(config);

    setSetupState(initial);
    if (initial !== 'checking') {
      return;
    }

    void resolveExplorerSetupState(config).then((resolved) => {
      if (!cancelled) {
        setSetupState(resolved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [config]);

  return setupState;
}
