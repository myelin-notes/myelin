import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteContentIndex } from './note-content-index';
import {
  type NoteSearchDocument,
  NoteSearchEngine,
} from './note-search-engine';
import { createEmptyManifest, createFileNode } from './shared';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

class SearchWorker {
  static instances: SearchWorker[] = [];
  static messages: Record<string, unknown>[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private readonly engine = new NoteSearchEngine();

  constructor() {
    SearchWorker.instances.push(this);
  }

  postMessage(message: Record<string, unknown>): void {
    SearchWorker.messages.push(message);
    switch (message.type) {
      case 'nodes':
        for (const node of message.nodes as NoteSearchDocument[]) {
          this.engine.upsert({
            ...node,
            content: this.engine.get(node.id)?.content ?? node.content,
          });
        }
        break;
      case 'remove':
        for (const id of message.ids as string[]) {
          this.engine.remove(id);
        }
        break;
      case 'content': {
        const node = this.engine.get(message.id as string);
        if (node) {
          this.engine.upsert({ ...node, content: message.content as string });
        }
        break;
      }
      case 'search':
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              requestId: message.requestId,
              hits: this.engine.search(
                message.query as string,
                message.limit as number | undefined,
              ),
            },
          } as MessageEvent),
        );
        break;
    }
  }

  terminate(): void {}
}

const handlers = new Map<string, EventListener>();
const source = {};
const manifest = createEmptyManifest();
manifest.nodes.alpha = createFileNode('alpha', 'Alpha', 'mcanvas', null, 1);

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) =>
    command === 'index_note_text' ? 'saved otter text' : undefined,
  );
  handlers.clear();
  SearchWorker.instances = [];
  SearchWorker.messages = [];
  vi.stubGlobal('Worker', SearchWorker);
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: EventListener) =>
      handlers.set(name, handler),
    removeEventListener: (name: string) => handlers.delete(name),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('NoteContentIndex', () => {
  it('indexes incrementally and searches saved content through the worker', async () => {
    const index = new NoteContentIndex();
    index.start('local', source, async () => [
      { nodeId: 'alpha', path: '/alpha' },
    ]);
    expect(index.getStatus()).toMatchObject({ scanning: true, indexed: 0 });
    expect(await index.search(manifest, 0, 'Alpha')).toHaveLength(1);
    expect(await index.search(manifest, 0, 'otter')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_200);
    expect(index.getStatus()).toMatchObject({
      indexed: 1,
      total: 1,
      failed: 0,
    });
    expect(
      (await index.search(manifest, 0, 'otter'))[0]?.contentSnippet,
    ).toContain('otter');
    index.stop();
  });

  it('coalesces saves and waits for quiet before indexing', async () => {
    const index = new NoteContentIndex();
    index.start('local', source, async () => []);
    index.invalidate(source, 'alpha');
    index.queueSaved(source, 'alpha', '/alpha');
    index.invalidate(source, 'alpha');
    index.queueSaved(source, 'alpha', '/alpha');
    await vi.advanceTimersByTimeAsync(600);
    index.invalidate(source, 'alpha');
    index.queueSaved(source, 'alpha', '/alpha');
    handlers.get('pointermove')?.({} as Event);
    await vi.advanceTimersByTimeAsync(600);
    expect(invoke).not.toHaveBeenCalledWith(
      'index_note_text',
      expect.anything(),
    );
    await vi.advanceTimersByTimeAsync(1_200);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('index_note_text', {
      repoId: 'local',
      nodeId: 'alpha',
      path: '/alpha',
      force: true,
    });
    index.stop();
  });

  it('removes cleared text promptly after the saved edit becomes quiet', async () => {
    const index = new NoteContentIndex();
    index.start('local', source, async () => [
      { nodeId: 'alpha', path: '/alpha' },
    ]);
    await index.search(manifest, 0, 'Alpha');
    await vi.advanceTimersByTimeAsync(1_200);
    expect(await index.search(manifest, 0, 'otter')).toHaveLength(1);

    const listener = vi.fn();
    index.subscribe(listener);
    await vi.advanceTimersByTimeAsync(800);
    handlers.get('keydown')?.({} as Event);
    await vi.advanceTimersByTimeAsync(1_000);
    invoke.mockImplementation(async (command: string) =>
      command === 'index_note_text' ? '' : undefined,
    );
    index.invalidate(source, 'alpha');
    index.queueSaved(source, 'alpha', '/alpha');
    const notifications = listener.mock.calls.length;

    await vi.advanceTimersByTimeAsync(199);
    expect(await index.search(manifest, 0, 'otter')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await index.search(manifest, 0, 'otter')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(listener.mock.calls.length).toBeGreaterThan(notifications);
    index.stop();
  });

  it('indexes a saved note before the remaining backfill', async () => {
    const index = new NoteContentIndex();
    index.start('local', source, async () => [
      { nodeId: 'alpha', path: '/alpha' },
      { nodeId: 'bravo', path: '/bravo' },
    ]);
    index.queueSaved(source, 'bravo', '/bravo');
    await vi.advanceTimersByTimeAsync(1_200);
    expect(invoke).toHaveBeenNthCalledWith(1, 'index_note_text', {
      repoId: 'local',
      nodeId: 'bravo',
      path: '/bravo',
      force: true,
    });
    index.stop();
  });

  it('cancels a deleted note and removes its cached text', async () => {
    const index = new NoteContentIndex();
    index.start('local', source, async () => [
      { nodeId: 'alpha', path: '/alpha' },
    ]);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(await index.search(manifest, 0, 'otter')).toHaveLength(1);

    index.remove(source, 'alpha');
    const withoutNote = createEmptyManifest();
    expect(await index.search(withoutNote, 1, 'otter')).toHaveLength(0);
    expect(invoke).toHaveBeenCalledWith('remove_note_text_index', {
      repoId: 'local',
      nodeId: 'alpha',
    });
    index.stop();
  });

  it('sends only changed metadata documents to the worker', async () => {
    const index = new NoteContentIndex();
    const withTwo = createEmptyManifest();
    withTwo.nodes.alpha = createFileNode('alpha', 'Alpha', 'mcanvas', null, 1);
    withTwo.nodes.bravo = createFileNode('bravo', 'Bravo', 'mcanvas', null, 1);
    index.start('local', source, async () => []);
    await index.search(withTwo, 0, 'Alpha');
    SearchWorker.messages = [];

    withTwo.nodes.bravo.name = 'Renamed Bravo';
    await index.search(withTwo, 1, 'Renamed');
    const nodes = SearchWorker.messages.filter(
      (message) => message.type === 'nodes',
    );
    expect(nodes).toHaveLength(1);
    expect(
      (nodes[0].nodes as NoteSearchDocument[]).map((node) => node.id),
    ).toEqual(['bravo']);
    index.stop();
  });

  it('rechecks notes after remote cache replacement', async () => {
    const index = new NoteContentIndex();
    let items = [{ nodeId: 'alpha', path: '/alpha' }];
    index.start('remote', source, async () => items);
    await vi.advanceTimersByTimeAsync(1_200);
    items = [{ nodeId: 'bravo', path: '/bravo' }];
    index.reconcile(source);
    const replaced = createEmptyManifest();
    replaced.nodes.bravo = createFileNode('bravo', 'Bravo', 'mcanvas', null, 1);

    expect(await index.search(replaced, 0, 'Alpha')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(invoke).toHaveBeenCalledWith('index_note_text', {
      repoId: 'remote',
      nodeId: 'bravo',
      path: '/bravo',
      force: true,
    });
    expect(await index.search(replaced, 0, 'otter')).toHaveLength(1);
    index.stop();
  });

  it('rebuilds the worker after a failure without losing content', async () => {
    const index = new NoteContentIndex();
    index.start('local', source, async () => [
      { nodeId: 'alpha', path: '/alpha' },
    ]);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(await index.search(manifest, 0, 'otter')).toHaveLength(1);

    SearchWorker.instances[0]?.onerror?.({} as ErrorEvent);
    await expect(index.search(manifest, 0, 'otter')).rejects.toThrow();
    expect(index.getStatus().loadError).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await index.search(manifest, 0, 'otter')).toHaveLength(1);
    expect(SearchWorker.instances).toHaveLength(2);
    expect(index.getStatus().loadError).toBe(false);
    index.stop();
  });

  it('keeps the worker unchanged when a saved note extracts to the same text', async () => {
    const index = new NoteContentIndex();
    index.start('local', source, async () => [
      { nodeId: 'alpha', path: '/alpha' },
    ]);
    await vi.advanceTimersByTimeAsync(1_200);
    await index.search(manifest, 0, 'otter');
    const revision = index.getStatus().revision;

    index.invalidate(source, 'alpha');
    index.queueSaved(source, 'alpha', '/alpha');
    expect(await index.search(manifest, 0, 'otter')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_200);

    expect(index.getStatus().revision).toBe(revision);
    expect(await index.search(manifest, 0, 'otter')).toHaveLength(1);
    index.stop();
  });

  it('ignores old repository work and reports failures without hiding titles', async () => {
    const index = new NoteContentIndex();
    const oldSource = {};
    index.start('old', oldSource, async () => [
      { nodeId: 'old', path: '/old' },
    ]);
    index.start('new', source, async () => [
      { nodeId: 'alpha', path: '/alpha' },
    ]);
    index.queueSaved(oldSource, 'old', '/old');
    invoke.mockRejectedValueOnce(new Error('unreadable'));
    await vi.advanceTimersByTimeAsync(1_200);

    expect(index.getStatus()).toMatchObject({ total: 1, failed: 1 });
    expect((await index.search(manifest, 0, 'Alpha'))[0]?.node.id).toBe(
      'alpha',
    );
    expect(invoke).toHaveBeenCalledWith('index_note_text', {
      repoId: 'new',
      nodeId: 'alpha',
      path: '/alpha',
      force: false,
    });
    index.stop();
  });
});
