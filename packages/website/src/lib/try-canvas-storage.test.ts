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

describe('persistTryCanvas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    vi.stubGlobal('window', new EventTarget());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('restores elements and page text after a reload', () => {
    const before = new Y.Doc();
    const stop = persistTryCanvas(before);
    addElement(before, 'a');
    before.getXmlFragment('pf-a').insert(0, [new Y.XmlText('hello')]);
    stop();

    const after = new Y.Doc();
    persistTryCanvas(after);
    expect(elementUuids(after)).toEqual(['a']);
    expect(after.getXmlFragment('pf-a').toString()).toBe('hello');
  });

  it("merges another tab's save instead of overwriting it", () => {
    const tabA = new Y.Doc();
    const tabB = new Y.Doc();
    persistTryCanvas(tabA);
    const stopB = persistTryCanvas(tabB);

    addElement(tabA, 'from-a');
    vi.runAllTimers();
    window.dispatchEvent(
      Object.assign(new Event('storage'), {
        key: 'myelin:try-canvas',
        newValue: localStorage.getItem('myelin:try-canvas'),
      }),
    );
    addElement(tabB, 'from-b');
    stopB();

    const reloaded = new Y.Doc();
    persistTryCanvas(reloaded);
    expect(elementUuids(reloaded)).toEqual(['from-a', 'from-b']);
  });
});
