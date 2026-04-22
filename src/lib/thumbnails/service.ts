import { Logger } from '@/lib/logger';
import * as cache from './cache';

export interface ThumbnailProducer {
  render(maxSize: number): Promise<Blob | null>;
}

const MAX_SIZE = 600;
const DEBOUNCE_MS = 750;

const logger = new Logger('ThumbnailService');

const producers = new Map<string, ThumbnailProducer>();
const subscribers = new Map<string, Set<() => void>>();
const debounceTimers = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();
const rerunRequested = new Set<string>();
const versions = new Map<string, number>();

export function registerThumbnailProducer(
  nodeId: string,
  producer: ThumbnailProducer,
): () => void {
  producers.set(nodeId, producer);
  return () => {
    if (producers.get(nodeId) === producer) {
      producers.delete(nodeId);
    }
  };
}

export function requestThumbnailRegeneration(nodeId: string): void {
  const prev = debounceTimers.get(nodeId);
  if (prev !== undefined) {
    window.clearTimeout(prev);
  }
  const timer = window.setTimeout(() => {
    debounceTimers.delete(nodeId);
    void runGenerate(nodeId).catch((err) => {
      logger.error('Scheduled regeneration failed', err, { nodeId });
    });
  }, DEBOUNCE_MS);
  debounceTimers.set(nodeId, timer);
}

export async function regenerateThumbnailNow(nodeId: string): Promise<void> {
  const timer = debounceTimers.get(nodeId);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    debounceTimers.delete(nodeId);
  }
  await runGenerate(nodeId);
}

export async function getThumbnailUrl(nodeId: string): Promise<string | null> {
  const url = await cache.readUrl(nodeId);
  if (url === null) {
    return null;
  }
  const v = versions.get(nodeId);
  return v === undefined ? url : `${url}?v=${v}`;
}

export function subscribeThumbnail(
  nodeId: string,
  callback: () => void,
): () => void {
  let set = subscribers.get(nodeId);
  if (set === undefined) {
    set = new Set();
    subscribers.set(nodeId, set);
  }
  set.add(callback);
  return () => {
    const current = subscribers.get(nodeId);
    if (current === undefined) {
      return;
    }
    current.delete(callback);
    if (current.size === 0) {
      subscribers.delete(nodeId);
    }
  };
}

export async function removeThumbnail(nodeId: string): Promise<void> {
  await cache.removeEntry(nodeId);
  bumpVersion(nodeId);
  notify(nodeId);
}

async function runGenerate(nodeId: string): Promise<void> {
  const existing = inflight.get(nodeId);
  if (existing !== undefined) {
    rerunRequested.add(nodeId);
    await existing;
    if (!rerunRequested.has(nodeId)) {
      return;
    }
    rerunRequested.delete(nodeId);
  }

  const producer = producers.get(nodeId);
  if (producer === undefined) {
    return;
  }

  const task = (async () => {
    try {
      const blob = await producer.render(MAX_SIZE);
      if (blob === null) {
        return;
      }
      await cache.writeBlob(nodeId, blob);
      bumpVersion(nodeId);
      notify(nodeId);
    } catch (err) {
      logger.error('Thumbnail generation failed', err, { nodeId });
    }
  })();

  inflight.set(nodeId, task);
  try {
    await task;
  } finally {
    if (inflight.get(nodeId) === task) {
      inflight.delete(nodeId);
    }
  }
}

function bumpVersion(nodeId: string): void {
  versions.set(nodeId, (versions.get(nodeId) ?? 0) + 1);
}

function notify(nodeId: string): void {
  const set = subscribers.get(nodeId);
  if (set === undefined) {
    return;
  }
  for (const cb of set) {
    try {
      cb();
    } catch (err) {
      logger.error('Subscriber threw', err, { nodeId });
    }
  }
}
