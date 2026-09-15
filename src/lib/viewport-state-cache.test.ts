import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '@myelin/editor/test/fake-platform';
import type { VFSNodeId } from '@/lib/sync';

const noteId = 'note-1' as VFSNodeId;

describe('viewport state cache', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('reads a saved viewport state and writes updates to the local cache', async () => {
    let saved: Blob | null = null;
    const write = vi.fn(async (_path: string, data: Blob) => {
      saved = data;
    });
    const { setPlatform } = await import('@myelin/editor/platform');
    setPlatform(
      createFakePlatform({
        artifactCache: {
          getUrl: async () => null,
          read: async () =>
            new Blob([
              JSON.stringify({
                [noteId]: { zoom: 1.5, offset: { x: 24, y: -12 } },
              }),
            ]),
          write,
          remove: async () => {},
        },
      }),
    );
    const { flushViewportStates, readViewportState, saveViewportState } =
      await import('./viewport-state-cache');

    expect(await readViewportState(noteId)).toEqual({
      zoom: 1.5,
      offset: { x: 24, y: -12 },
    });

    saveViewportState(noteId, { zoom: 2, offset: { x: 50, y: 25 } });
    await flushViewportStates();

    expect(write).toHaveBeenCalledWith('viewport-state.json', expect.any(Blob));
    expect(saved).toBeInstanceOf(Blob);
    expect(JSON.parse(await saved!.text())).toEqual({
      [noteId]: { zoom: 2, offset: { x: 50, y: 25 } },
    });
  });
});
