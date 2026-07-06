import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type {
  ActiveRepository,
  NoteSessionStatus,
  VFSNodeId,
} from '@/lib/sync';
import { CanvasSessionController } from './use-session-controller';

const { drawableCanvasCtor, resolveNoteLinkRefByTitleMock } = vi.hoisted(
  () => ({
    drawableCanvasCtor: vi.fn().mockImplementation(function DrawableCanvas() {
      return {
        elements: [{ id: 'existing-element' }],
        setBackgroundCanvas: vi.fn(),
        setOverlayCanvas: vi.fn(),
        setDomOverlayHost: vi.fn(),
        setOnPageFrameRenamed: vi.fn(),
        setLivePeers: vi.fn(),
        destroy: vi.fn(),
      };
    }),
    resolveNoteLinkRefByTitleMock: vi.fn(),
  }),
);

vi.mock('@myelin/editor/drawable-canvas', () => ({
  DrawableCanvas: drawableCanvasCtor,
}));

vi.mock('@myelin/editor/elements/page-frame-element', () => ({
  PageFrameElement: class PageFrameElement {},
}));

vi.mock('@myelin/editor/page-frame/note-link/resolution', () => ({
  resolveNoteLinkRefByTitle: resolveNoteLinkRefByTitleMock,
}));

type ControllerRepository = ActiveRepository;
type ControllerDrawableCanvasRef = RefObject<DrawableCanvas | null>;

interface MockNoteSession {
  id: VFSNodeId;
  ydoc: { kind: string };
  subscribeStatus: (
    listener: (status: NoteSessionStatus) => void,
  ) => () => void;
  subscribePeerSnapshot: (listener: (snapshot: unknown) => void) => () => void;
  close: () => Promise<void>;
  save: () => Promise<void>;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createSession(id: VFSNodeId): MockNoteSession {
  return {
    id,
    ydoc: { kind: `ydoc:${id}` },
    subscribeStatus: vi.fn((listener) => {
      listener({
        phase: 'idle',
        remoteRevision: null,
        lastError: null,
      });
      return vi.fn();
    }),
    subscribePeerSnapshot: vi.fn(() => vi.fn()),
    close: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('CanvasSessionController', () => {
  it('opens the latest note without waiting for a stale open to finish', async () => {
    const noteAOpen = createDeferred<MockNoteSession>();
    const noteBOpen = createDeferred<MockNoteSession>();
    const noteASession = createSession('note-a');
    const noteBSession = createSession('note-b');
    const repository = {
      kind: 'local',
      openSession: vi.fn((noteId: VFSNodeId) => {
        if (noteId === 'note-a') {
          return noteAOpen.promise;
        }
        if (noteId === 'note-b') {
          return noteBOpen.promise;
        }
        throw new Error(`Unexpected note id: ${noteId}`);
      }),
      getNode: vi.fn(async (noteId: VFSNodeId) => ({
        type: 'file',
        name: `${noteId}.mcanvas`,
      })),
      searchNodes: vi.fn(),
    };
    const drawableCanvasRef: ControllerDrawableCanvasRef = { current: null };
    const controller = new CanvasSessionController(
      repository as unknown as ControllerRepository,
      { current: {} as HTMLCanvasElement },
      { current: null },
      { current: null },
      { current: null },
      drawableCanvasRef,
      { current: [] },
    );

    const openAPromise = controller.open('note-a');
    await vi.waitFor(() =>
      expect(repository.openSession).toHaveBeenCalledWith('note-a'),
    );

    const openBPromise = controller.open('note-b');
    await vi.waitFor(() =>
      expect(repository.openSession).toHaveBeenCalledWith('note-b'),
    );

    expect(repository.openSession).toHaveBeenNthCalledWith(2, 'note-b');

    noteBOpen.resolve(noteBSession);
    await openBPromise;

    expect(controller.getSnapshot().noteSession).toBe(noteBSession);
    expect(controller.getSnapshot().fileName).toBe('note-b.mcanvas');
    expect(drawableCanvasCtor).toHaveBeenCalledTimes(1);
    expect(drawableCanvasRef.current).toBe(
      drawableCanvasCtor.mock.results[0]?.value,
    );

    noteAOpen.resolve(noteASession);
    await openAPromise;

    expect(noteASession.close).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().noteSession).toBe(noteBSession);
    expect(controller.getSnapshot().fileName).toBe('note-b.mcanvas');
    expect(drawableCanvasCtor).toHaveBeenCalledTimes(1);
  });

  it('passes the note link resolver into DrawableCanvas', async () => {
    const repository = {
      kind: 'local',
      openSession: vi.fn().mockResolvedValue(createSession('note-1')),
      getNode: vi.fn().mockResolvedValue(undefined),
      searchNodes: vi.fn(),
    };
    const controller = new CanvasSessionController(
      repository as unknown as ControllerRepository,
      { current: {} as HTMLCanvasElement },
      { current: null },
      { current: null },
      { current: null },
      { current: null },
      { current: [] },
    );

    resolveNoteLinkRefByTitleMock.mockResolvedValue({
      noteId: 'resolved-note-id',
      pageFrameId: 'resolved-frame-id',
    });

    await controller.open('note-1');

    expect(drawableCanvasCtor).toHaveBeenCalledTimes(1);
    const resolveNoteLink = drawableCanvasCtor.mock.calls[0]?.[3];
    expect(resolveNoteLink).toEqual(expect.any(Function));

    const resolved = await resolveNoteLink('Alpha Note');
    expect(resolved).toEqual({
      noteId: 'resolved-note-id',
      pageFrameId: 'resolved-frame-id',
    });
    expect(resolveNoteLinkRefByTitleMock).toHaveBeenCalledWith(
      repository,
      'Alpha Note',
      expect.any(Map),
    );

    await controller.dispose();
  });

  it('does not attach a late session after dispose', async () => {
    const pendingOpen = createDeferred<MockNoteSession>();
    const noteSession = createSession('note-1');
    const repository = {
      kind: 'local',
      openSession: vi.fn().mockReturnValue(pendingOpen.promise),
      getNode: vi.fn(),
      searchNodes: vi.fn(),
    };
    const drawableCanvasRef: ControllerDrawableCanvasRef = { current: null };
    const controller = new CanvasSessionController(
      repository as unknown as ControllerRepository,
      { current: {} as HTMLCanvasElement },
      { current: null },
      { current: null },
      { current: null },
      drawableCanvasRef,
      { current: [] },
    );

    const openPromise = controller.open('note-1');
    await vi.waitFor(() =>
      expect(repository.openSession).toHaveBeenCalledWith('note-1'),
    );
    const disposePromise = controller.dispose();

    pendingOpen.resolve(noteSession);
    await openPromise;
    await disposePromise;

    expect(noteSession.close).toHaveBeenCalledTimes(1);
    expect(repository.getNode).not.toHaveBeenCalled();
    expect(drawableCanvasCtor).not.toHaveBeenCalled();
    expect(drawableCanvasRef.current).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      noteSession: null,
      ready: false,
    });
  });
});
