import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RepositoryConfig } from './repo/config';
import { isRepositoryFullyConfigured } from './repo/readiness';

export const MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS = 5_000;

type RefreshTask = () => Promise<void>;

let lastStartedAt = 0;
let running = false;
let queued: RefreshTask | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

async function run(task: RefreshTask): Promise<void> {
  lastStartedAt = Date.now();
  running = true;
  notify();
  try {
    await task();
  } catch {
    // Task is responsible for its own error handling.
  }
  running = false;
  notify();
  schedule();
}

function schedule(): void {
  if (timer !== null || running || queued === null) {
    return;
  }
  const remaining =
    MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS - (Date.now() - lastStartedAt);
  if (remaining <= 0) {
    const task = queued;
    queued = null;
    void run(task);
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    schedule();
  }, remaining);
}

export function enqueueManualRepositoryRefresh(task: RefreshTask): void {
  // Coalescing: if a task is already queued, drop the incoming one. Manual
  // refreshes are idempotent triggers, so the queued task is sufficient.
  if (queued !== null) {
    return;
  }
  queued = task;
  notify();
  schedule();
}

function getPending(): boolean {
  return running || queued !== null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useManualRepositoryRefreshPending(): boolean {
  return useSyncExternalStore(subscribe, getPending);
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
  lastStartedAt = 0;
  running = false;
  queued = null;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  notify();
}
