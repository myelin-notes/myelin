import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '../platform';
import type { VFSNodeId } from '../sync/types';
import { createFakePlatform } from '../test/fake-platform';
import {
  clearAllThumbnails,
  ensureThumbnail,
  regenerateThumbnailNow,
  registerThumbnailProducer,
  removeThumbnail,
  requestThumbnailRegeneration,
  settleThumbnail,
} from './service';

const writeArtifact = vi.fn(async () => {});
const removeArtifact = vi.fn(async () => {});

describe('thumbnail service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeArtifact.mockClear();
    removeArtifact.mockClear();
    setPlatform(
      createFakePlatform({
        artifactCache: {
          getUrl: async () => null,
          read: async () => null,
          write: writeArtifact,
          remove: removeArtifact,
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
      expect(writeArtifact).toHaveBeenCalledTimes(2);
    });
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

  it('renders a note with no cached thumbnail, even if it closes before the delay', async () => {
    const nodeId = 'thumbnail-missing' as VFSNodeId;
    const render = vi.fn(async () => new Blob(['thumbnail']));
    const unregister = registerThumbnailProducer(nodeId, { render });

    await ensureThumbnail(nodeId, { delayMs: 3_000 });
    expect(render).not.toHaveBeenCalled();

    unregister();
    await vi.waitFor(() => {
      expect(writeArtifact).toHaveBeenCalledTimes(1);
    });
  });

  it('leaves an existing thumbnail alone', async () => {
    const nodeId = 'thumbnail-present' as VFSNodeId;
    setPlatform(
      createFakePlatform({
        artifactCache: {
          getUrl: async () => 'asset://thumbnail.png',
          read: async () => null,
          write: writeArtifact,
          remove: async () => {},
        },
      }),
    );
    const render = vi.fn(async () => new Blob(['thumbnail']));
    const unregister = registerThumbnailProducer(nodeId, { render });

    await ensureThumbnail(nodeId, { delayMs: 3_000 });
    await vi.advanceTimersByTimeAsync(3_000);

    expect(render).not.toHaveBeenCalled();

    unregister();
  });

  it('gives up on a stuck render so teardown and later renders can proceed', async () => {
    const nodeId = 'thumbnail-stuck-render' as VFSNodeId;
    let finishStuckRender!: (blob: Blob) => void;
    const render = vi
      .fn<() => Promise<Blob>>()
      .mockImplementationOnce(
        () =>
          new Promise<Blob>((resolve) => {
            finishStuckRender = resolve;
          }),
      )
      .mockResolvedValue(new Blob(['fresh']));
    const unregister = registerThumbnailProducer(nodeId, { render });

    const stuck = regenerateThumbnailNow(nodeId);
    const settled = settleThumbnail(nodeId);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([stuck, settled]);

    expect(writeArtifact).not.toHaveBeenCalled();

    await regenerateThumbnailNow(nodeId);

    expect(writeArtifact).toHaveBeenCalledTimes(1);

    // A partial image would never be replaced, so a late result has to stay dropped.
    finishStuckRender(new Blob(['late']));
    await vi.advanceTimersByTimeAsync(0);

    expect(writeArtifact).toHaveBeenCalledTimes(1);

    unregister();
  });

  it('does not write a deleted note back when its tab closes', async () => {
    const nodeId = 'thumbnail-removed-pending' as VFSNodeId;
    const render = vi.fn(async () => new Blob(['thumbnail']));
    const unregister = registerThumbnailProducer(nodeId, { render });

    requestThumbnailRegeneration(nodeId);
    await removeThumbnail(nodeId);
    unregister();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(removeArtifact).toHaveBeenCalledWith(`Thumbnails/${nodeId}.png`);
    expect(render).not.toHaveBeenCalled();
    expect(writeArtifact).not.toHaveBeenCalled();
  });

  it('deletes the file after a render already writing it', async () => {
    const nodeId = 'thumbnail-removed-inflight' as VFSNodeId;
    let finishRender!: (blob: Blob) => void;
    const unregister = registerThumbnailProducer(nodeId, {
      render: () =>
        new Promise<Blob>((resolve) => {
          finishRender = resolve;
        }),
    });

    const rendering = regenerateThumbnailNow(nodeId);
    const removing = removeThumbnail(nodeId);
    await vi.advanceTimersByTimeAsync(0);

    expect(removeArtifact).not.toHaveBeenCalled();

    finishRender(new Blob(['thumbnail']));
    await Promise.all([rendering, removing]);

    expect(writeArtifact.mock.invocationCallOrder[0]).toBeLessThan(
      removeArtifact.mock.invocationCallOrder[0],
    );

    unregister();
  });

  it('does not write a thumbnail back after clearing them all', async () => {
    const nodeId = 'thumbnail-cleared-pending' as VFSNodeId;
    const render = vi.fn(async () => new Blob(['thumbnail']));
    const unregister = registerThumbnailProducer(nodeId, { render });

    requestThumbnailRegeneration(nodeId);
    await clearAllThumbnails();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(removeArtifact).toHaveBeenCalledWith('Thumbnails');
    expect(writeArtifact).not.toHaveBeenCalled();

    unregister();
  });

  it('does not render on unregister without a pending regeneration', () => {
    const nodeId = 'thumbnail-unregister-idle' as VFSNodeId;
    const render = vi.fn(async () => new Blob(['thumbnail']));
    const unregister = registerThumbnailProducer(nodeId, { render });

    unregister();

    expect(render).not.toHaveBeenCalled();
  });
});
