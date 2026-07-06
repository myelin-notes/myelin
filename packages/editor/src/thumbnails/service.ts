import { Logger } from '../logger';
import { getPlatform } from '../platform';
import type { VFSNodeId } from '../sync/types';

export interface ThumbnailProducer {
  render(
    maxSize: number,
    options: ThumbnailRenderOptions,
  ): Promise<Blob | null>;
}

export interface ThumbnailRenderOptions {
  reason: 'scheduled' | 'immediate';
}

export interface ThumbnailRegenerationOptions {
  delayMs?: number;
}

const MAX_SIZE = 600;
const SCHEDULED_DEBOUNCE_MS = 30_000;
const THUMBNAILS_DIR = 'Thumbnails';

function cachePath(nodeId: VFSNodeId): string {
  return `${THUMBNAILS_DIR}/${nodeId}.png`;
}

const logger = new Logger('ThumbnailService');
type ThumbnailTimer = ReturnType<typeof globalThis.setTimeout>;

const producers = new Map<VFSNodeId, ThumbnailProducer>();
const subscribers = new Map<VFSNodeId, Set<() => void>>();
const debounceTimers = new Map<VFSNodeId, ThumbnailTimer>();
const inflight = new Map<VFSNodeId, Promise<void>>();
const rerunRequested = new Set<VFSNodeId>();
const versions = new Map<VFSNodeId, number>();

export function registerThumbnailProducer(
  nodeId: VFSNodeId,
  producer: ThumbnailProducer,
): () => void {
  producers.set(nodeId, producer);
  let disposed = false;
  return () => {
    if (disposed || producers.get(nodeId) !== producer) {
      return;
    }
    disposed = true;
    const pending = debounceTimers.get(nodeId);
    if (pending !== undefined) {
      globalThis.clearTimeout(pending);
      debounceTimers.delete(nodeId);
      // Flush while the producer is still registered: a final snapshot on
      // close beats silently dropping the latest edits.
      void runGenerate(nodeId, 'immediate')
        .catch((err) => {
          logger.error('Unregister flush failed', err, { nodeId });
        })
        .finally(() => {
          if (producers.get(nodeId) === producer) {
            producers.delete(nodeId);
          }
        });
      return;
    }
    producers.delete(nodeId);
  };
}

export function requestThumbnailRegeneration(
  nodeId: VFSNodeId,
  options: ThumbnailRegenerationOptions = {},
): void {
  const prev = debounceTimers.get(nodeId);
  if (prev !== undefined) {
    globalThis.clearTimeout(prev);
  }
  const delayMs = options.delayMs ?? SCHEDULED_DEBOUNCE_MS;
  const timer = globalThis.setTimeout(() => {
    debounceTimers.delete(nodeId);
    void runGenerate(nodeId, 'scheduled').catch((err) => {
      logger.error('Scheduled regeneration failed', err, { nodeId });
    });
  }, delayMs);
  debounceTimers.set(nodeId, timer);
}

export async function regenerateThumbnailNow(nodeId: VFSNodeId): Promise<void> {
  const timer = debounceTimers.get(nodeId);
  if (timer !== undefined) {
    globalThis.clearTimeout(timer);
    debounceTimers.delete(nodeId);
  }
  await runGenerate(nodeId, 'immediate');
}

export async function getThumbnailUrl(
  nodeId: VFSNodeId,
): Promise<string | null> {
  const url = await getPlatform().artifactCache.getUrl(cachePath(nodeId));
  if (url === null) {
    return null;
  }
  const v = versions.get(nodeId);
  return v === undefined ? url : `${url}?v=${v}`;
}

export function subscribeThumbnail(
  nodeId: VFSNodeId,
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

export async function clearAllThumbnails(): Promise<void> {
  await getPlatform().artifactCache.remove(THUMBNAILS_DIR);
}

export async function removeThumbnail(nodeId: VFSNodeId): Promise<void> {
  await getPlatform().artifactCache.remove(cachePath(nodeId));
  bumpVersion(nodeId);
  notify(nodeId);
}

async function runGenerate(
  nodeId: VFSNodeId,
  reason: 'scheduled' | 'immediate',
): Promise<void> {
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
      const blob = await producer.render(MAX_SIZE, { reason });
      if (blob === null) {
        return;
      }
      await getPlatform().artifactCache.write(cachePath(nodeId), blob);
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

function bumpVersion(nodeId: VFSNodeId): void {
  versions.set(nodeId, (versions.get(nodeId) ?? 0) + 1);
}

function notify(nodeId: VFSNodeId): void {
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
