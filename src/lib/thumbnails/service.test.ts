import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VFSNodeId } from '@/lib/sync';
import { setPlatform } from '@/platform';
import { createFakePlatform } from '@/test/fake-platform';
import {
  regenerateThumbnailNow,
  registerThumbnailProducer,
  requestThumbnailRegeneration,
} from './service';

const writeArtifact = vi.fn(async () => {});

describe('thumbnail service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeArtifact.mockClear();
    setPlatform(
      createFakePlatform({
        artifactCache: {
          getUrl: async () => null,
          write: writeArtifact,
          remove: async () => {},
        },
      }),
    );
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
    expect(writeArtifact).toHaveBeenCalledTimes(1);

    await regenerateThumbnailNow(nodeId);

    expect(render).toHaveBeenLastCalledWith(600, { reason: 'immediate' });
    expect(writeArtifact).toHaveBeenCalledTimes(2);

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
    expect(writeArtifact).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending unregister regeneration after an inflight render', async () => {
    const nodeId = 'thumbnail-unregister-inflight-flush' as VFSNodeId;
    let finishFirstRender!: (blob: Blob) => void;
    let renderCount = 0;
    const firstRender = new Promise<Blob>((resolve) => {
      finishFirstRender = resolve;
    });
    const render = vi.fn(() => {
      renderCount += 1;
      if (renderCount === 1) {
        return firstRender;
      }
      return Promise.resolve(new Blob(['final-thumbnail']));
    });
    const unregister = registerThumbnailProducer(nodeId, { render });

    const initialRender = regenerateThumbnailNow(nodeId);
    expect(render).toHaveBeenCalledTimes(1);

    requestThumbnailRegeneration(nodeId);
    unregister();
    unregister();

    finishFirstRender(new Blob(['initial-thumbnail']));
    await initialRender;

    await vi.waitFor(() => {
      expect(render).toHaveBeenCalledTimes(2);
    });
    expect(writeArtifact).toHaveBeenCalledTimes(2);
  });

  it('does not remove a newer producer after an old unregister flush finishes', async () => {
    const nodeId = 'thumbnail-unregister-new-producer' as VFSNodeId;
    let finishOldRender!: (blob: Blob) => void;
    const oldRender = new Promise<Blob>((resolve) => {
      finishOldRender = resolve;
    });
    const unregisterOld = registerThumbnailProducer(nodeId, {
      render: vi.fn(() => oldRender),
    });

    const initialRender = regenerateThumbnailNow(nodeId);
    requestThumbnailRegeneration(nodeId);
    unregisterOld();

    const newRender = vi.fn(async () => new Blob(['new-thumbnail']));
    const unregisterNew = registerThumbnailProducer(nodeId, {
      render: newRender,
    });

    finishOldRender(new Blob(['old-thumbnail']));
    await initialRender;

    await vi.waitFor(() => {
      expect(newRender).toHaveBeenCalledTimes(1);
    });

    await regenerateThumbnailNow(nodeId);

    expect(newRender).toHaveBeenCalledTimes(2);

    unregisterNew();
  });

  it('does not render on unregister without a pending regeneration', () => {
    const nodeId = 'thumbnail-unregister-idle' as VFSNodeId;
    const render = vi.fn(async () => new Blob(['thumbnail']));
    const unregister = registerThumbnailProducer(nodeId, { render });

    unregister();

    expect(render).not.toHaveBeenCalled();
  });
});
