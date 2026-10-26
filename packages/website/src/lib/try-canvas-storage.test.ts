import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { persistTryCanvas } from './try-canvas-storage';

function addElement(doc: Y.Doc, uuid: string): void {
  const element = new Y.Map<unknown>();
  element.set('uuid', uuid);
  doc.getArray<Y.Map<unknown>>('elements').push([element]);
}

function elementUuids(doc: Y.Doc): string[] {
  return doc
    .getArray<Y.Map<unknown>>('elements')
    .toArray()
    .map((element) => element.get('uuid') as string)
    .sort();
}

// Opens the canvas as a fresh page load would, once the saved state is in.
async function reload(expectedUuids: string[]): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const stop = persistTryCanvas(doc);
  await vi.waitFor(() => expect(elementUuids(doc)).toEqual(expectedUuids));
  stop();
  return doc;
}

describe('persistTryCanvas', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores elements and page text after a reload', async () => {
    const doc = new Y.Doc();
    const stop = persistTryCanvas(doc);
    addElement(doc, 'a');
    doc.getXmlFragment('pf-a').insert(0, [new Y.XmlText('hello')]);
    stop();

    const reloaded = await reload(['a']);
    expect(reloaded.getXmlFragment('pf-a').toString()).toBe('hello');
  });

  it('keeps edits made while the saved canvas is still loading', async () => {
    const first = new Y.Doc();
    const stopFirst = persistTryCanvas(first);
    addElement(first, 'old');
    stopFirst();

    const second = new Y.Doc();
    const stopSecond = persistTryCanvas(second);
    addElement(second, 'early');
    await vi.waitFor(() =>
      expect(elementUuids(second)).toEqual(['early', 'old']),
    );
    stopSecond();

    await reload(['early', 'old']);
  });

  it('shares edits between open tabs and keeps both after a reload', async () => {
    const seed = new Y.Doc();
    const stopSeed = persistTryCanvas(seed);
    addElement(seed, 'seed');
    stopSeed();

    const tabA = new Y.Doc();
    const tabB = new Y.Doc();
    const stopA = persistTryCanvas(tabA);
    const stopB = persistTryCanvas(tabB);
    await vi.waitFor(() => {
      expect(elementUuids(tabA)).toEqual(['seed']);
      expect(elementUuids(tabB)).toEqual(['seed']);
    });
    addElement(tabA, 'from-a');
    addElement(tabB, 'from-b');
    await vi.waitFor(() =>
      expect(elementUuids(tabB)).toEqual(['from-a', 'from-b', 'seed']),
    );
    stopA();
    stopB();

    await reload(['from-a', 'from-b', 'seed']);
  });
});
