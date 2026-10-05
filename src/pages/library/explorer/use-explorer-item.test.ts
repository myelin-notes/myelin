import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  return {
    states,
    refs,
    stateIndex: 0,
    refIndex: 0,
    dirty: false,
    repository: { renameNode: vi.fn(async () => {}) },
  };
});

vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = mocks.stateIndex++;
    if (!(index in mocks.states)) {
      mocks.states[index] = initial;
    }
    return [
      mocks.states[index],
      (value: unknown) => {
        mocks.states[index] = value;
        mocks.dirty = true;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mocks.refIndex++;
    mocks.refs[index] ??= { current: initial };
    return mocks.refs[index];
  },
  useEffect: vi.fn(),
}));
vi.mock('@myelin/editor/i18n', () => ({ useMessages: () => ({}) }));
vi.mock('@myelin/editor/user-prefs', () => ({
  UserPrefs: { get: () => false },
}));
vi.mock('@/lib/sync', () => ({ useRepository: () => mocks.repository }));
vi.mock('@/lib/sync/repo/rename-note-references', () => ({
  renameNoteReferences: vi.fn(),
}));

import { useExplorerItem } from './use-explorer-item';

const onRenameEnd = vi.fn();
const onChanged = vi.fn();

function renderItem(initialRenaming: boolean) {
  let item: ReturnType<typeof useExplorerItem>;
  do {
    mocks.stateIndex = 0;
    mocks.refIndex = 0;
    mocks.dirty = false;
    // biome-ignore lint/correctness/useHookAtTopLevel: mocked hooks replay render-time state updates.
    item = useExplorerItem({
      nodeId: 'new-item',
      name: 'Untitled',
      dragKind: 'file',
      initialRenaming,
      onRenameEnd,
      onChanged,
    });
  } while (mocks.dirty);
  return item;
}

afterEach(() => {
  mocks.states = [];
  mocks.refs = [];
  vi.clearAllMocks();
});

describe('new item renaming', () => {
  it('starts when creation finishes after a repository refresh already mounted the item', () => {
    expect(renderItem(false).renaming).toBe(false);
    expect(renderItem(true).renaming).toBe(true);
    expect(renderItem(true).renaming).toBe(true);
    expect(onRenameEnd).not.toHaveBeenCalled();
  });

  it('starts on mount when the item renders after creation finishes', () => {
    expect(renderItem(true).renaming).toBe(true);
  });

  it('ends the request on Escape without restarting on an unchanged request', () => {
    const item = renderItem(true);
    item.renameInputProps.onKeyDown({
      key: 'Escape',
    } as React.KeyboardEvent<HTMLInputElement>);
    expect(onRenameEnd).toHaveBeenCalledWith('new-item');
    expect(renderItem(true).renaming).toBe(false);
    expect(renderItem(false).renaming).toBe(false);
    expect(renderItem(true).renaming).toBe(true);
  });

  it('ends the request on blur even when the name is unchanged', async () => {
    await renderItem(true).renameInputProps.onBlur();
    expect(onRenameEnd).toHaveBeenCalledWith('new-item');
    expect(mocks.repository.renameNode).not.toHaveBeenCalled();
    expect(renderItem(false).renaming).toBe(false);
  });

  it('keeps the request until the rename commits', async () => {
    renderItem(true).renameInputProps.onChange({
      target: { value: 'My note' },
    } as React.ChangeEvent<HTMLInputElement>);
    await renderItem(true).renameInputProps.onBlur();
    expect(mocks.repository.renameNode).toHaveBeenCalledWith(
      'new-item',
      'My note',
    );
    expect(onRenameEnd).toHaveBeenCalledWith('new-item');
    expect(onChanged).toHaveBeenCalledOnce();
    expect(renderItem(false).renaming).toBe(false);
  });
});
