import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteIndexService } from './service';

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
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  readNodeText.mockReset();
  listIndexedNodeIds.mockReset();
  listIndexedNodeIds.mockResolvedValue([]);
  listenHandler = null;
});

describe('NoteIndexService', () => {
  it('requestReindex invokes the engine with camelCase args', () => {
    const service = new NoteIndexService();
    service.requestReindex('n1', '/files/n1.mcanvas', 'mcanvas');
    expect(invoke).toHaveBeenCalledWith('reindex_note', {
      nodeId: 'n1',
      path: '/files/n1.mcanvas',
      fileType: 'mcanvas',
    });
  });

  it('updates the corpus and notifies on an index-updated event', async () => {
    readNodeText.mockResolvedValue('hello indexed world');
    const service = new NoteIndexService();
    const subscriber = vi.fn();
    service.subscribe(subscriber);
    await service.init();
    expect(listenHandler).toBeTruthy();

    listenHandler?.({ payload: { nodeId: 'n1' } });
    await flush();

    expect(service.getContent().get('n1')).toBe('hello indexed world');
    expect(subscriber).toHaveBeenCalled();
  });

  it('hydrates the corpus from existing artifacts at startup', async () => {
    listIndexedNodeIds.mockResolvedValue(['n1', 'n2']);
    readNodeText.mockImplementation(async (id: string) =>
      id === 'n1' ? 'first note' : 'second note',
    );
    const service = new NoteIndexService();
    await service.init();

    expect(service.getContent().get('n1')).toBe('first note');
    expect(service.getContent().get('n2')).toBe('second note');
  });

  it('removeIndex clears the corpus entry and invokes remove_index', async () => {
    listIndexedNodeIds.mockResolvedValue(['n1']);
    readNodeText.mockResolvedValue('doomed text');
    const service = new NoteIndexService();
    await service.init();
    expect(service.getContent().get('n1')).toBe('doomed text');

    await service.removeIndex('n1');

    expect(service.getContent().has('n1')).toBe(false);
    expect(invoke).toHaveBeenCalledWith('remove_index', { nodeId: 'n1' });
  });

  it('startBackfill forwards items and skips empty batches', () => {
    const service = new NoteIndexService();
    const items = [
      { nodeId: 'n1', path: '/files/n1.mcanvas', fileType: 'mcanvas' },
    ];
    service.startBackfill(items);
    expect(invoke).toHaveBeenCalledWith('reindex_batch', { items });

    invoke.mockClear();
    service.startBackfill([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
