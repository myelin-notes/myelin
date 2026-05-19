import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RepositoryConfig } from './repo/config';
import { isRepositoryFullyConfigured } from './repo/readiness';

export const MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS = 5_000;

let lastManualRepositoryRefreshStartedAt = 0;
let manualRepositoryRefreshInFlight = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function reserveManualRepositoryRefresh(now = Date.now()): boolean {
  if (manualRepositoryRefreshInFlight) {
    return false;
  }

  if (
    now - lastManualRepositoryRefreshStartedAt <
    MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS
  ) {
    return false;
  }

  lastManualRepositoryRefreshStartedAt = now;
  manualRepositoryRefreshInFlight = true;
  notify();
  return true;
}

export function finishManualRepositoryRefresh(): void {
  if (!manualRepositoryRefreshInFlight) {
    return;
  }
  manualRepositoryRefreshInFlight = false;
  notify();
}

export function getManualRepositoryRefreshInFlight(): boolean {
  return manualRepositoryRefreshInFlight;
}

function subscribeManualRepositoryRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useManualRepositoryRefreshInFlight(): boolean {
  return useSyncExternalStore(
    subscribeManualRepositoryRefresh,
    getManualRepositoryRefreshInFlight,
    getManualRepositoryRefreshInFlight,
  );
}

export function useManualRepositoryRefreshAvailable(
  config: RepositoryConfig,
  initializing: boolean,
): boolean {
  const [fullyConfigured, setFullyConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (config.kind === 'local') {
      setFullyConfigured(false);
      return;
    }

    setFullyConfigured(false);
    void isRepositoryFullyConfigured(config)
      .then((configured) => {
        if (!cancelled) {
          setFullyConfigured(configured);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFullyConfigured(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [config]);

  return fullyConfigured && !initializing;
}

export function resetManualRepositoryRefreshForTests(): void {
  lastManualRepositoryRefreshStartedAt = 0;
  manualRepositoryRefreshInFlight = false;
  notify();
}
