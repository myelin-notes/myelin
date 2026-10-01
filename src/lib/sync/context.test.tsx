import { act, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { RepositoryProvider } from './context';
import type { RepositoryConfig } from './repo/config';
import { setRepositoryConfig } from './repo/repository-settings';
import { createEmptyManifest, createFileNode } from './repo/shared';
import {
  type RepositoryContextValue,
  useRepository,
  useRepositoryStatus,
} from './repo-context';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock('./analytics', () => ({
  createSyncCompletionTracker: () => () => {},
}));
vi.mock('./shutdown-gate', () => ({
  RepositoryShutdownGate: () => null,
}));

it('loads the saved repository after Strict Mode replay and releases it on switch and unmount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  // Only null-rendering consumers run here; this container tests React lifecycle, not DOM behavior.
  const ownerDocument = {
    nodeType: 9,
    addEventListener: () => {},
    defaultView: { document: {}, HTMLIFrameElement: class {} },
  };
  const root = createRoot({
    nodeType: 1,
    tagName: 'DIV',
    ownerDocument,
    addEventListener: () => {},
  } as unknown as HTMLElement);
  const config: RepositoryConfig = {
    kind: 'github',
    owner: 'myelin',
    repo: 'notes',
    branch: 'main',
    credentialId: 'work',
  };
  setRepositoryConfig(config);
  const manifest = createEmptyManifest();
  manifest.nodes.saved = createFileNode(
    'saved',
    'Saved note',
    'mcanvas',
    null,
    1,
  );
  const handles = new Set<string>();
  let opens = 0;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'repository_open') {
      const handle = `handle-${++opens}`;
      handles.add(handle);
      return {
        handle,
        status: {
          repositoryId:
            (args as { request: { storageRoot: string } }).request
              .storageRoot || 'local',
          online: true,
          pendingRemoteWrites: 0,
          lastRemoteSyncAt: 1,
          lastError: null,
          dataVersion: 0,
        },
      };
    }
    const { handle } = args as { handle: string };
    if (command === 'repository_release') {
      expect(handles.delete(handle)).toBe(true);
      return;
    }
    expect(handles.has(handle)).toBe(true);
    expect(command).toBe('repository_operation');
    expect(args).toMatchObject({ operation: { kind: 'manifest' } });
    return { manifest, revision: '1' };
  });
  let current: RepositoryContextValue | null = null;
  const mounted = vi.fn();
  const cleanedUp = vi.fn();
  function Consumer() {
    const repository = useRepository();
    const status = useRepositoryStatus();
    useEffect(() => {
      current = { repository, status };
    }, [repository, status]);
    useEffect(() => {
      mounted();
      return cleanedUp;
    }, []);
    return null;
  }
  function active(): RepositoryContextValue {
    expect(current).not.toBeNull();
    return current!;
  }
  try {
    await act(async () => {
      root.render(
        <StrictMode>
          <RepositoryProvider>
            <Consumer />
          </RepositoryProvider>
        </StrictMode>,
      );
    });
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(cleanedUp).toHaveBeenCalledTimes(1);
    expect(active().status.initializing).toBe(false);
    expect(active().status.lastError).toBeNull();
    expect(active().status.config).toEqual(config);
    await expect(active().repository.getRecentFiles()).resolves.toEqual([
      manifest.nodes.saved,
    ]);
    expect(opens).toBe(1);
    expect(handles.size).toBe(1);
    const previous = active().repository;
    await act(async () => {
      setRepositoryConfig({ kind: 'local' });
    });
    expect(active().repository).not.toBe(previous);
    await expect(previous.getRecentFiles()).rejects.toThrow(
      'Repository is closed',
    );
    await expect(active().repository.getRecentFiles()).resolves.toEqual([
      manifest.nodes.saved,
    ]);
    expect(opens).toBe(2);
    expect(handles).toEqual(new Set(['handle-2']));
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
  expect(handles.size).toBe(0);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === 'repository_release'),
  ).toEqual([
    ['repository_release', { handle: 'handle-1' }],
    ['repository_release', { handle: 'handle-2' }],
  ]);
});
