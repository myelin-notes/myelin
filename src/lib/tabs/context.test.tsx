import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabStateProvider, useTabController } from './context';
import type { WindowState } from './types';

function stubWindowSearch(search: string) {
  const replaceState = vi.fn();
  vi.stubGlobal('window', {
    location: { search },
    history: { replaceState },
  });
  return { replaceState };
}

function renderInitialState(): WindowState {
  let state: WindowState | null = null;

  function CaptureState() {
    state = useTabController().getSnapshot();
    return null;
  }

  renderToString(
    <TabStateProvider>
      <CaptureState />
    </TabStateProvider>,
  );

  expect(state).not.toBeNull();
  return state!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TabStateProvider', () => {
  it('falls back to the default tab state when init-tab is malformed', () => {
    const { replaceState } = stubWindowSearch('?init-tab=%7B');

    const state = renderInitialState();

    expect(replaceState).toHaveBeenCalledWith({}, '', '/');
    expect(state.layout.type).toBe('pane');
    if (state.layout.type === 'pane') {
      // The default editor opens empty; tabs are created by opening files.
      expect(state.layout.tabs).toEqual([]);
    }
  });
});
