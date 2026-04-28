import { describe, expect, it, vi } from 'vitest';
import {
  PageFrameAutocompleteController,
  type PageFrameAutocompleteItem,
  scalePageFrameAutocompleteAnchorRect,
} from './index';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function keyEvent(key: string) {
  return {
    key,
    preventDefault: vi.fn(),
  };
}

describe('PageFrameAutocompleteController', () => {
  it('loads items and activates the first result', async () => {
    const controller = new PageFrameAutocompleteController({
      source: async ({ query }) => [
        {
          id: `${query}-1`,
          title: `${query} note`,
        },
      ],
    });

    controller.show({
      query: 'alpha',
      range: { from: 4, to: 9 },
    });

    expect(controller.getState()).toMatchObject({
      open: true,
      query: 'alpha',
      range: { from: 4, to: 9 },
      anchorPosition: 9,
      status: 'loading',
      activeIndex: -1,
    });

    await flushMicrotasks();

    expect(controller.getState()).toMatchObject({
      status: 'open',
      activeIndex: 0,
      items: [
        {
          id: 'alpha-1',
          title: 'alpha note',
        },
      ],
    });
  });

  it('ignores stale results when a newer query replaces them', async () => {
    const first = deferred<readonly PageFrameAutocompleteItem[]>();
    const second = deferred<readonly PageFrameAutocompleteItem[]>();
    const controller = new PageFrameAutocompleteController({
      source: ({ query }) => (query === 'a' ? first.promise : second.promise),
    });

    controller.show({
      query: 'a',
      range: { from: 2, to: 3 },
    });
    controller.show({
      query: 'ab',
      range: { from: 2, to: 4 },
    });

    first.resolve([{ id: 'stale', title: 'Stale note' }]);
    await flushMicrotasks();

    expect(controller.getState()).toMatchObject({
      query: 'ab',
      status: 'loading',
      items: [],
    });

    second.resolve([{ id: 'fresh', title: 'Fresh note' }]);
    await flushMicrotasks();

    expect(controller.getState()).toMatchObject({
      query: 'ab',
      status: 'open',
      items: [{ id: 'fresh', title: 'Fresh note' }],
    });
  });

  it('wraps keyboard navigation and returns the selected item', async () => {
    const controller = new PageFrameAutocompleteController({
      source: async () => [
        { id: 'one', title: 'One' },
        { id: 'two', title: 'Two' },
        { id: 'three', title: 'Three' },
      ],
    });

    controller.show({
      query: 'o',
      range: { from: 1, to: 2 },
    });
    await flushMicrotasks();

    const up = keyEvent('ArrowUp');
    const upResult = controller.handleKeyDown(up);

    expect(upResult).toEqual({ handled: true, action: 'navigate' });
    expect(up.preventDefault).toHaveBeenCalled();
    expect(controller.getState().activeIndex).toBe(2);

    const enter = keyEvent('Enter');
    const enterResult = controller.handleKeyDown(enter);

    expect(enter.preventDefault).toHaveBeenCalled();
    expect(enterResult).toEqual({
      handled: true,
      action: 'select',
      item: { id: 'three', title: 'Three' },
    });
    expect(controller.getState()).toMatchObject({
      open: false,
      status: 'closed',
      activeIndex: -1,
    });
  });
});

describe('scalePageFrameAutocompleteAnchorRect', () => {
  it('scales editor coords into screen pixels', () => {
    expect(
      scalePageFrameAutocompleteAnchorRect(
        {
          left: 10,
          right: 14,
          top: 20,
          bottom: 28,
        },
        2,
      ),
    ).toEqual({
      left: 20,
      right: 28,
      top: 40,
      bottom: 56,
      width: 8,
      height: 16,
    });
  });
});
