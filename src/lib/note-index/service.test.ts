import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
let listenHandler: ((event: { payload: { nodeId: string } }) => void) | null =
  null;
const readNodeText = vi.fn();
const listIndexedNodeIds = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (
    _name: string,
    handler: (event: { payload: { nodeId: string } }) => void,
  ) => {
    listenHandler = handler;
    return () => {};
  },
}));

vi.mock('./cache', () => ({
  readNodeText: (...args: unknown[]) => readNodeText(...args),
  listIndexedNodeIds: (...args: unknown[]) => listIndexedNodeIds(...args),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  readNodeText.mockReset();
  listIndexedNodeIds.mockReset();
  listIndexedNodeIds.mockResolvedValue([]);
  listenHandler = null;
});

describe('note-index service', () => {
  it('requestReindex invokes the engine with camelCase args', async () => {
    const svc = await import('./service');
    svc.requestReindex('n1', '/files/n1.mcanvas', 'mcanvas');
    expect(invoke).toHaveBeenCalledWith('reindex_note', {
      nodeId: 'n1',
      path: '/files/n1.mcanvas',
      fileType: 'mcanvas',
    });
  });

  it('updates the corpus and notifies on an index-updated event', async () => {
    readNodeText.mockResolvedValue('hello indexed world');
    const svc = await import('./service');
    const subscriber = vi.fn();
    svc.subscribeIndex(subscriber);
    await svc.initNoteIndex();
    expect(listenHandler).toBeTruthy();

    listenHandler?.({ payload: { nodeId: 'n1' } });
    await flush();

    expect(svc.getIndexContent().get('n1')).toBe('hello indexed world');
    expect(subscriber).toHaveBeenCalled();
  });

  it('hydrates the corpus from existing artifacts at startup', async () => {
    listIndexedNodeIds.mockResolvedValue(['n1', 'n2']);
    readNodeText.mockImplementation(async (id: string) =>
      id === 'n1' ? 'first note' : 'second note',
    );
    const svc = await import('./service');
    await svc.initNoteIndex();

    expect(svc.getIndexContent().get('n1')).toBe('first note');
    expect(svc.getIndexContent().get('n2')).toBe('second note');
  });

  it('removeIndex clears the corpus entry and invokes remove_index', async () => {
    listIndexedNodeIds.mockResolvedValue(['n1']);
    readNodeText.mockResolvedValue('doomed text');
    const svc = await import('./service');
    await svc.initNoteIndex();
    expect(svc.getIndexContent().get('n1')).toBe('doomed text');

    await svc.removeIndex('n1');

    expect(svc.getIndexContent().has('n1')).toBe(false);
    expect(invoke).toHaveBeenCalledWith('remove_index', { nodeId: 'n1' });
  });

  it('startBackfill forwards items and skips empty batches', async () => {
    const svc = await import('./service');
    const items = [
      { nodeId: 'n1', path: '/files/n1.mcanvas', fileType: 'mcanvas' },
    ];
    svc.startBackfill(items);
    expect(invoke).toHaveBeenCalledWith('reindex_batch', { items });

    invoke.mockClear();
    svc.startBackfill([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
