import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteIndexService } from './service';

const invoke = vi.fn();
let listenHandler:
  | ((event: { payload: { nodeId: string; repoId: string } }) => void)
  | null = null;
const readNodeRecord = vi.fn();
const listIndexedNodeIds = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (
    _name: string,
    handler: (event: { payload: { nodeId: string; repoId: string } }) => void,
  ) => {
    listenHandler = handler;
    return () => {};
  },
}));

vi.mock('./cache', () => ({
  readNodeRecord: (...args: unknown[]) => readNodeRecord(...args),
  listIndexedNodeIds: (...args: unknown[]) => listIndexedNodeIds(...args),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  readNodeRecord.mockReset();
  listIndexedNodeIds.mockReset();
  listIndexedNodeIds.mockResolvedValue([]);
  listenHandler = null;
});

function record(text: string, vector?: number[]) {
  return {
    nodeId: 'n1',
    sourceHash: 'hash',
    schemaVersion: 4,
    text,
    embedding: vector
      ? {
          model: 'Qdrant/all-MiniLM-L6-v2-onnx',
          dim: vector.length,
          vector,
        }
      : null,
    providers: [],
    updatedAt: 1,
  };
}

describe('NoteIndexService', () => {
  it('requestReindex invokes the engine with the active repo and camelCase args', async () => {
    const service = new NoteIndexService();
    await service.init('repo-a');
    service.requestReindex('n1', '/files/n1.mcanvas', 'mcanvas');
    expect(invoke).toHaveBeenCalledWith('reindex_note', {
      repoId: 'repo-a',
      nodeId: 'n1',
      path: '/files/n1.mcanvas',
      fileType: 'mcanvas',
    });
  });

  it('skips reindex/backfill/remove while no repo is active', async () => {
    const service = new NoteIndexService();
    service.requestReindex('n1', '/files/n1.mcanvas', 'mcanvas');
    service.startBackfill([
      { nodeId: 'n1', path: '/files/n1.mcanvas', fileType: 'mcanvas' },
    ]);
    await service.removeIndex('n1');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('updates the corpus on an index-updated event for the active repo', async () => {
    readNodeRecord.mockResolvedValue(record('hello indexed world', [0.1, 0.2]));
    const service = new NoteIndexService();
    await service.init('repo-a');
    expect(listenHandler).toBeTruthy();

    listenHandler?.({ payload: { nodeId: 'n1', repoId: 'repo-a' } });
    await flush();

    expect(service.getContent().get('n1')).toBe('hello indexed world');
    expect(service.getEmbeddings().get('n1')?.vector).toEqual([0.1, 0.2]);
  });

  it('ignores index-updated events for a different repo', async () => {
    readNodeRecord.mockResolvedValue(record('stale repo text'));
    const service = new NoteIndexService();
    await service.init('repo-a');

    listenHandler?.({ payload: { nodeId: 'n1', repoId: 'repo-b' } });
    await flush();

    expect(service.getContent().has('n1')).toBe(false);
  });

  it('hydrates the corpus from the active repo artifacts at startup', async () => {
    listIndexedNodeIds.mockResolvedValue(['n1', 'n2']);
    readNodeRecord.mockImplementation(async (_repoId: string, id: string) =>
      id === 'n1' ? record('first note', [1]) : record('second note'),
    );
    const service = new NoteIndexService();
    await service.init('repo-a');

    expect(listIndexedNodeIds).toHaveBeenCalledWith('repo-a');
    expect(service.getContent().get('n1')).toBe('first note');
    expect(service.getContent().get('n2')).toBe('second note');
    expect(service.getEmbeddings().get('n1')?.vector).toEqual([1]);
  });

  it('reset clears the corpus and detaches from the active repo', async () => {
    listIndexedNodeIds.mockResolvedValue(['n1']);
    readNodeRecord.mockResolvedValue(record('old repo text', [1]));
    const service = new NoteIndexService();
    await service.init('repo-a');
    expect(service.getContent().get('n1')).toBe('old repo text');

    service.reset();
    expect(service.getContent().has('n1')).toBe(false);
    expect(service.getEmbeddings().has('n1')).toBe(false);

    // With no active repo, triggers are no-ops.
    service.requestReindex('n1', '/files/n1.mcanvas', 'mcanvas');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('removeIndex clears the corpus entry and invokes remove_index', async () => {
    listIndexedNodeIds.mockResolvedValue(['n1']);
    readNodeRecord.mockResolvedValue(record('doomed text', [1]));
    const service = new NoteIndexService();
    await service.init('repo-a');
    expect(service.getContent().get('n1')).toBe('doomed text');

    await service.removeIndex('n1');

    expect(service.getContent().has('n1')).toBe(false);
    expect(service.getEmbeddings().has('n1')).toBe(false);
    expect(invoke).toHaveBeenCalledWith('remove_index', {
      repoId: 'repo-a',
      nodeId: 'n1',
    });
  });

  it('startBackfill forwards items with the active repo and skips empty batches', async () => {
    const service = new NoteIndexService();
    await service.init('repo-a');
    const items = [
      { nodeId: 'n1', path: '/files/n1.mcanvas', fileType: 'mcanvas' },
    ];
    service.startBackfill(items);
    expect(invoke).toHaveBeenCalledWith('reindex_batch', {
      repoId: 'repo-a',
      items,
    });

    invoke.mockClear();
    service.startBackfill([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
