import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VFSNodeId } from '@/lib/sync';
import * as cache from './cache';
import {
  regenerateThumbnailNow,
  registerThumbnailProducer,
  requestThumbnailRegeneration,
} from './service';

vi.mock('./cache', () => ({
  readUrl: vi.fn(async () => null),
  removeEntry: vi.fn(async () => undefined),
  writeBlob: vi.fn(async () => undefined),
}));

describe('thumbnail service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(cache.writeBlob).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks scheduled and immediate thumbnail renders', async () => {
    const nodeId = 'thumbnail-render-reason' as VFSNodeId;
    const render = vi.fn(async () => new Blob(['thumbnail']));
    const unregister = registerThumbnailProducer(nodeId, { render });

    requestThumbnailRegeneration(nodeId);
    await vi.advanceTimersByTimeAsync(29_999);

    expect(render).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(render).toHaveBeenCalledWith(600, { reason: 'scheduled' });
    expect(cache.writeBlob).toHaveBeenCalledTimes(1);

    await regenerateThumbnailNow(nodeId);

    expect(render).toHaveBeenLastCalledWith(600, { reason: 'immediate' });
    expect(cache.writeBlob).toHaveBeenCalledTimes(2);

    unregister();
  });

  it('supports shorter explicit scheduled delays', async () => {
    const nodeId = 'thumbnail-custom-delay' as VFSNodeId;
    const render = vi.fn(async () => new Blob(['thumbnail']));
    const unregister = registerThumbnailProducer(nodeId, { render });

    requestThumbnailRegeneration(nodeId, { delayMs: 3_000 });
    await vi.advanceTimersByTimeAsync(2_999);

    expect(render).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(render).toHaveBeenCalledWith(600, { reason: 'scheduled' });

    unregister();
  });

  it('flushes a pending regeneration when the producer unregisters', async () => {
    const nodeId = 'thumbnail-unregister-flush' as VFSNodeId;
    const render = vi.fn(async () => new Blob(['thumbnail']));
    const unregister = registerThumbnailProducer(nodeId, { render });

    requestThumbnailRegeneration(nodeId);
    unregister();

    expect(render).toHaveBeenCalledWith(600, { reason: 'immediate' });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(render).toHaveBeenCalledTimes(1);
    expect(cache.writeBlob).toHaveBeenCalledTimes(1);
  });

  it('does not render on unregister without a pending regeneration', () => {
    const nodeId = 'thumbnail-unregister-idle' as VFSNodeId;
    const render = vi.fn(async () => new Blob(['thumbnail']));
    const unregister = registerThumbnailProducer(nodeId, { render });

    unregister();

    expect(render).not.toHaveBeenCalled();
  });
});
