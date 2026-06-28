import { useEffect, useState } from 'react';
import {
  isRepositoryConfigStructurallyComplete,
  isRepositoryFullyConfigured,
  type RepositoryConfig,
  useRepositoryStatus,
} from '@/lib/sync';

export type RepositorySetupState = 'checking' | 'ready' | 'setup-required';

function getInitialState(config: RepositoryConfig): RepositorySetupState {
  if (config.kind === 'local') {
    return 'ready';
  }
  return isRepositoryConfigStructurallyComplete(config)
    ? 'checking'
    : 'setup-required';
}

/**
 * Tracks whether the active repository is ready to read from. Local
 * repositories are always ready; remote ones are 'checking' until their
 * configuration is verified, then 'ready' or 'setup-required'. Extracted from
 * the former ExplorerTree so both the folder tree and the file pane can gate
 * loading on the same state.
 */
export function useRepositorySetupState(): RepositorySetupState {
  const repositoryStatus = useRepositoryStatus();
  const [state, setState] = useState<RepositorySetupState>(() =>
    getInitialState(repositoryStatus.config),
  );

  useEffect(() => {
    let cancelled = false;
    const config = repositoryStatus.config;

    if (config.kind === 'local') {
      setState('ready');
      return;
    }

    if (!isRepositoryConfigStructurallyComplete(config)) {
      setState('setup-required');
      return;
    }

    setState('checking');
    void isRepositoryFullyConfigured(config).then((configured) => {
      if (!cancelled) {
        setState(configured ? 'ready' : 'setup-required');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [repositoryStatus.config]);

  return state;
}
