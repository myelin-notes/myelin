import { afterEach, describe, expect, it, vi } from 'vitest';

type EffectCallback = () => undefined | (() => void);

const mocks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as EffectCallback[],
  repository: {
    createFileVersionIfDue: vi.fn(),
  },
  regenerateThumbnailNow: vi.fn(async () => {}),
  requestThumbnailRegeneration: vi.fn(),
  saveSessionAndCreateVersion: vi.fn(async () => true),
}));

vi.mock('react', () => ({
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  useEffect: (effect: EffectCallback) => {
    mocks.effects.push(effect);
  },
  useRef: <T>(initialValue: T) => {
    const index = mocks.refIndex;
    mocks.refIndex += 1;
    if (!mocks.refs[index]) {
      mocks.refs[index] = { current: initialValue };
    }
    return mocks.refs[index];
  },
}));

vi.mock('@/lib/sync', () => ({
  useRepository: () => mocks.repository,
}));

vi.mock('@/lib/thumbnails', () => ({
  regenerateThumbnailNow: mocks.regenerateThumbnailNow,
  requestThumbnailRegeneration: mocks.requestThumbnailRegeneration,
}));

vi.mock('./session-version-history', () => ({
  saveSessionAndCreateVersion: mocks.saveSessionAndCreateVersion,
}));

import { POINT_FLUSH_INTERVAL_MS } from '@myelin/editor/elements/stroke-element';
import { useCanvasSessionSaving } from './use-session-saving';

interface MockNoteSession {
  id: string;
  hasUnsyncedChanges: () => boolean;
  save: () => Promise<void>;
  subscribeLocalChanges: (listener: () => void) => () => void;
  subscribePeerSnapshot: (
    listener: (snapshot: { isWriter: boolean }) => void,
  ) => () => void;
}

function createSession(id: string, hasUnsyncedChanges = true) {
  let localChangeListener = () => {};
  const session: MockNoteSession = {
    id,
    hasUnsyncedChanges: vi.fn(() => hasUnsyncedChanges),
    save: vi.fn(async () => {}),
    subscribeLocalChanges: vi.fn((listener) => {
      localChangeListener = listener;
      return vi.fn();
    }),
    subscribePeerSnapshot: vi.fn((listener) => {
      listener({ isWriter: false });
      return vi.fn();
    }),
  };

  return {
    session,
    emitLocalChange: () => localChangeListener(),
  };
}

function renderSaving(noteId: string, noteSession: MockNoteSession | null) {
  mocks.refIndex = 0;
  mocks.effects = [];
  // biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked in this focused cleanup-order test.
  return useCanvasSessionSaving({
    noteId,
    noteSession: noteSession as never,
  });
}

afterEach(() => {
  mocks.refs = [];
  mocks.refIndex = 0;
  mocks.effects = [];
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('useCanvasSessionSaving', () => {
  it('flushes the session captured by the cleanup when leaving a note', async () => {
    vi.stubGlobal('window', {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      setInterval: vi.fn(() => 2),
      clearInterval: vi.fn(),
    });
    const noteA = createSession('note-a');
    const noteB = createSession('note-b');

    renderSaving('note-a', noteA.session);
    const cleanupNoteA = mocks.effects[0]?.();
    expect(cleanupNoteA).toEqual(expect.any(Function));

    noteA.emitLocalChange();
    expect(window.setTimeout).toHaveBeenCalled();

    renderSaving('note-b', noteB.session);
    (cleanupNoteA as () => void)();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.saveSessionAndCreateVersion).toHaveBeenCalledWith(
      noteA.session,
      mocks.repository,
    );
    expect(mocks.saveSessionAndCreateVersion).not.toHaveBeenCalledWith(
      noteB.session,
      mocks.repository,
    );
  });

  it('debounces saves for longer than a live stroke flushes points', () => {
    // A stroke in progress writes its points to Yjs every
    // POINT_FLUSH_INTERVAL_MS, and every one of those restarts this debounce.
    // If the debounce were the shorter of the two it would expire inside each
    // gap, turning "save once the edits stop" into a full document save several
    // times a second for as long as the pen is down.
    vi.stubGlobal('window', {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      setInterval: vi.fn(() => 2),
      clearInterval: vi.fn(),
    });
    const note = createSession('note-a');

    renderSaving('note-a', note.session);
    mocks.effects[0]?.();
    note.emitLocalChange();

    const delay = (window.setTimeout as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[1] as number;
    expect(delay).toBeGreaterThan(POINT_FLUSH_INTERVAL_MS);
  });

  it('does not regenerate the thumbnail when leaving an unchanged note', async () => {
    mocks.saveSessionAndCreateVersion.mockResolvedValueOnce(false);
    const note = createSession('note-a', false);

    const saving = renderSaving('note-a', note.session);
    await saving.saveBeforeExit();

    expect(mocks.saveSessionAndCreateVersion).toHaveBeenCalledWith(
      note.session,
      mocks.repository,
    );
    expect(mocks.regenerateThumbnailNow).not.toHaveBeenCalled();
  });

  it('regenerates the thumbnail when the save reports teardown-time changes', async () => {
    mocks.saveSessionAndCreateVersion.mockResolvedValueOnce(true);
    const note = createSession('note-a', false);

    const saving = renderSaving('note-a', note.session);
    await saving.saveBeforeExit();

    expect(mocks.saveSessionAndCreateVersion).toHaveBeenCalledWith(
      note.session,
      mocks.repository,
    );
    expect(mocks.regenerateThumbnailNow).toHaveBeenCalledWith('note-a');
  });
});
