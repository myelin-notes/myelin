import { afterEach, describe, expect, it, vi } from 'vitest';

type EffectCallback = () => undefined | (() => void);

const mocks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as EffectCallback[],
  repository: {
    createFileVersionIfDue: vi.fn(),
  },
  ensureThumbnail: vi.fn(async () => {}),
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

vi.mock('@myelin/editor/thumbnails', () => ({
  ensureThumbnail: mocks.ensureThumbnail,
  regenerateThumbnailNow: mocks.regenerateThumbnailNow,
  requestThumbnailRegeneration: mocks.requestThumbnailRegeneration,
}));

vi.mock('./session-version-history', () => ({
  saveSessionAndCreateVersion: mocks.saveSessionAndCreateVersion,
}));

import { useCanvasSessionSaving } from './use-session-saving';

interface MockNoteSession {
  id: string;
  ydoc: { elements: { length: number } };
  hasUnsyncedChanges: () => boolean;
  save: () => Promise<void>;
  subscribeLocalChanges: (listener: () => void) => () => void;
  subscribePeerSnapshot: (
    listener: (snapshot: { isWriter: boolean }) => void,
  ) => () => void;
}

function stubDocument(visibilityState: DocumentVisibilityState = 'visible') {
  const doc = Object.assign(new EventTarget(), { visibilityState });
  vi.stubGlobal('document', doc);
  return {
    setVisibility(next: DocumentVisibilityState) {
      doc.visibilityState = next;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

function createSession(
  id: string,
  hasUnsyncedChanges = true,
  isWriter = false,
  elementCount = 1,
) {
  let localChangeListener = () => {};
  const session: MockNoteSession = {
    id,
    ydoc: { elements: { length: elementCount } },
    hasUnsyncedChanges: vi.fn(() => hasUnsyncedChanges),
    save: vi.fn(async () => {}),
    subscribeLocalChanges: vi.fn((listener) => {
      localChangeListener = listener;
      return vi.fn();
    }),
    subscribePeerSnapshot: vi.fn((listener) => {
      listener({ isWriter });
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
    stubDocument();
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

  it('saves on hide and pauses the autosave until the app is shown again', async () => {
    vi.stubGlobal('window', {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      setInterval: vi.fn(() => 2),
      clearInterval: vi.fn(),
    });
    const visibility = stubDocument();
    const note = createSession('note-a', true, true);

    renderSaving('note-a', note.session);
    mocks.effects[0]?.();
    expect(window.setInterval).toHaveBeenCalledTimes(1);

    visibility.setVisibility('hidden');
    await Promise.resolve();
    expect(window.clearInterval).toHaveBeenCalledWith(2);
    expect(mocks.saveSessionAndCreateVersion).toHaveBeenCalledWith(
      note.session,
      mocks.repository,
    );

    visibility.setVisibility('visible');
    expect(window.setInterval).toHaveBeenCalledTimes(2);
  });

  it('requests a missing thumbnail when opening a note without any edit', () => {
    stubDocument();
    const note = createSession('note-a', false);

    renderSaving('note-a', note.session);
    mocks.effects[0]?.();

    expect(mocks.ensureThumbnail).toHaveBeenCalledWith('note-a', {
      delayMs: 3_000,
    });
  });

  it('leaves an empty note on the placeholder', () => {
    stubDocument();
    const note = createSession('note-a', false, false, 0);

    renderSaving('note-a', note.session);
    mocks.effects[0]?.();

    expect(mocks.ensureThumbnail).not.toHaveBeenCalled();
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
