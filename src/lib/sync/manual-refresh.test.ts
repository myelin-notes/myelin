import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueManualRepositoryRefresh,
  MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS,
  resetManualRepositoryRefreshForTests,
} from './manual-refresh';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('manual repository refresh cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(10_000));
    resetManualRepositoryRefreshForTests();
  });

  afterEach(() => {
    resetManualRepositoryRefreshForTests();
    vi.useRealTimers();
  });

  it('runs the first refresh immediately', async () => {
    const d = deferred();
    const task = vi.fn(() => d.promise);

    enqueueManualRepositoryRefresh(task);

    expect(task).toHaveBeenCalledTimes(1);

    d.resolve();
    await vi.runAllTimersAsync();
  });

  it('queues a click during cooldown and fires it when the cooldown ends', async () => {
    const first = deferred();
    const firstTask = vi.fn(() => first.promise);
    const secondTask = vi.fn(() => Promise.resolve());

    enqueueManualRepositoryRefresh(firstTask);
    expect(firstTask).toHaveBeenCalledTimes(1);

    first.resolve();
    await vi.advanceTimersByTimeAsync(200);

    enqueueManualRepositoryRefresh(secondTask);
    expect(secondTask).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(
      MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS - 200,
    );

    expect(secondTask).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple clicks during the cooldown into a single queued refresh', async () => {
    const first = deferred();
    const firstTask = vi.fn(() => first.promise);

    enqueueManualRepositoryRefresh(firstTask);
    first.resolve();
    await vi.advanceTimersByTimeAsync(100);

    const queuedA = vi.fn(() => Promise.resolve());
    const queuedB = vi.fn(() => Promise.resolve());
    const queuedC = vi.fn(() => Promise.resolve());

    enqueueManualRepositoryRefresh(queuedA);
    enqueueManualRepositoryRefresh(queuedB);
    enqueueManualRepositoryRefresh(queuedC);

    await vi.advanceTimersByTimeAsync(MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS);

    expect(queuedA).toHaveBeenCalledTimes(1);
    expect(queuedB).not.toHaveBeenCalled();
    expect(queuedC).not.toHaveBeenCalled();
  });

  it('queues a click that arrives while the previous refresh is still in flight', async () => {
    const first = deferred();
    const firstTask = vi.fn(() => first.promise);
    const secondTask = vi.fn(() => Promise.resolve());

    enqueueManualRepositoryRefresh(firstTask);
    enqueueManualRepositoryRefresh(secondTask);

    expect(secondTask).not.toHaveBeenCalled();

    first.resolve();
    await vi.advanceTimersByTimeAsync(MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS);

    expect(secondTask).toHaveBeenCalledTimes(1);
  });

  it('runs a refresh immediately once the cooldown has elapsed', async () => {
    const first = deferred();
    enqueueManualRepositoryRefresh(() => first.promise);
    first.resolve();
    await vi.advanceTimersByTimeAsync(MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS);

    const nextTask = vi.fn(() => Promise.resolve());
    enqueueManualRepositoryRefresh(nextTask);

    expect(nextTask).toHaveBeenCalledTimes(1);
  });

  it('continues queuing after a failed refresh', async () => {
    const failingTask = vi.fn(() => Promise.reject(new Error('boom')));
    const queuedTask = vi.fn(() => Promise.resolve());

    enqueueManualRepositoryRefresh(failingTask);
    enqueueManualRepositoryRefresh(queuedTask);

    await vi.advanceTimersByTimeAsync(MANUAL_REPOSITORY_REFRESH_COOLDOWN_MS);

    expect(queuedTask).toHaveBeenCalledTimes(1);
  });
});
