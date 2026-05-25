import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Logger } from '@/lib/logger';
import type { NoteBacklink, NoteSession, VFSNodeId } from '@/lib/sync';
import {
  type ActiveRepository,
  type NoteSessionStatus,
  useRepository,
} from '@/lib/sync';
import { renamePageFrameReferences } from '@/lib/sync/repo/rename-page-frame-references';
import { UserPrefs } from '@/lib/user-prefs';
import { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import { PageFrameElement } from '@/pages/canvas/elements/page-frame-element';
import {
  type PageFrameNameCache,
  resolveNoteLinkRefByTitle,
} from '@/pages/canvas/page-frame/note-link-resolution';
import { buildRenamePageFrameLinkReferencesTransaction } from '@/pages/canvas/page-frame/pm/markdown/note-links';
import { schema as pageFrameSchema } from '@/pages/canvas/page-frame/pm/schema';
import type { ITool } from '@/pages/canvas/tools/tool';
import type { YDocManager } from '@/pages/canvas/ydoc-manager';
import type {
  RenameReferencesChoice,
  RenameReferencesPrompt,
} from '@/pages/library/explorer/use-explorer-item';

type PageFrameRenameListener = (
  ownerNoteId: VFSNodeId,
  pageFrameId: string,
  newName: string,
) => void;

interface PendingPageFrameRename {
  ownerNoteId: VFSNodeId;
  newName: string;
  backlinks: NoteBacklink[];
}

interface PendingPageFrameRenamePrompt extends RenameReferencesPrompt {
  ownerNoteId: VFSNodeId;
  pageFrameId: string;
  newName: string;
  backlinks: NoteBacklink[];
}

const logger = new Logger('CanvasSessionController');

export interface CanvasSessionSnapshot {
  noteSession: NoteSession | null;
  ydoc: YDocManager | null;
  fileName: string;
  status: NoteSessionStatus | null;
  error: Error | null;
  ready: boolean;
}

const EMPTY_SNAPSHOT: CanvasSessionSnapshot = {
  noteSession: null,
  ydoc: null,
  fileName: '',
  status: null,
  error: null,
  ready: false,
};

interface ActiveCanvasSession {
  noteSession: NoteSession;
  drawableCanvas: DrawableCanvas;
  unsubscribeStatus: () => void;
}

export class CanvasSessionController {
  private snapshot: CanvasSessionSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();

  private lifecycleToken = 0;
  private teardownQueue: Promise<void> = Promise.resolve();
  private activeSession: ActiveCanvasSession | null = null;
  private lifecycleError: Error | null = null;
  private onPageFrameRenamed: PageFrameRenameListener | null = null;

  constructor(
    private readonly repository: ActiveRepository,
    private readonly canvasRef: RefObject<HTMLCanvasElement | null>,
    private readonly bgCanvasRef: RefObject<HTMLCanvasElement | null>,
    private readonly overlayCanvasRef: RefObject<HTMLCanvasElement | null>,
    private readonly domOverlayRef: RefObject<HTMLDivElement | null>,
    private readonly drawableCanvasRef: RefObject<DrawableCanvas | null>,
    private readonly canvasToolsRef: RefObject<ITool[]>,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CanvasSessionSnapshot => this.snapshot;

  async open(
    noteId: VFSNodeId,
    options?: { initialPageFrameName?: string | null },
  ): Promise<void> {
    const token = ++this.lifecycleToken;
    await this.teardownActiveSession();
    if (token !== this.lifecycleToken) {
      return;
    }
    await this.openSession(
      noteId,
      token,
      options?.initialPageFrameName ?? null,
    );
  }

  async dispose(): Promise<void> {
    this.lifecycleToken += 1;
    await this.teardownActiveSession();
  }

  async restoreVersion(noteId: VFSNodeId, bytes: Uint8Array): Promise<void> {
    const token = ++this.lifecycleToken;
    await this.teardownActiveSession();
    if (token !== this.lifecycleToken) {
      return;
    }
    await this.repository.writeFileBytes(noteId, bytes);
    await this.openSession(noteId, token, null);
  }

  setOnPageFrameRenamed(listener: PageFrameRenameListener | null): void {
    this.onPageFrameRenamed = listener;
  }

  private async openSession(
    noteId: VFSNodeId,
    token: number,
    initialPageFrameName: string | null,
  ): Promise<void> {
    const canvas = this.canvasRef.current;
    if (!canvas) {
      this.setLifecycleError(new Error('Canvas is not mounted.'));
      return;
    }

    let session: NoteSession | null = null;
    let drawableCanvas: DrawableCanvas | null = null;

    try {
      logger.debug('Opening canvas session', {
        id: noteId,
        repositoryKind: this.repository.kind,
      });

      session = await this.repository.openSession(noteId);
      if (this.shouldAbortOpen(token)) {
        await this.cleanupAbandonedSession(session);
        return;
      }

      const node = await this.repository.getNode(noteId);
      if (this.shouldAbortOpen(token)) {
        await this.cleanupAbandonedSession(session);
        return;
      }

      const frameNameCache: PageFrameNameCache = new Map();
      drawableCanvas = new DrawableCanvas(
        canvas,
        session.ydoc,
        this.canvasToolsRef.current,
        async (title) =>
          resolveNoteLinkRefByTitle(this.repository, title, frameNameCache),
      );
      drawableCanvas.setOnPageFrameRenamed((uuid, newName) => {
        this.handlePageFrameRenamed(noteId, uuid, newName);
      });

      if (this.bgCanvasRef.current) {
        drawableCanvas.setBackgroundCanvas(this.bgCanvasRef.current);
      }
      if (this.overlayCanvasRef.current) {
        drawableCanvas.setOverlayCanvas(this.overlayCanvasRef.current);
      }
      if (this.domOverlayRef.current) {
        drawableCanvas.setDomOverlayHost(this.domOverlayRef.current);
      }

      if (drawableCanvas.elements.length === 0 && node?.type === 'file') {
        const dpr = window.devicePixelRatio || 1;
        const centerWorld = drawableCanvas.viewport.screenToWorld({
          x: canvas.width / dpr / 2,
          y: canvas.height / dpr / 2,
        });
        const frame = drawableCanvas.addElement(
          (uuid) =>
            new PageFrameElement(
              uuid,
              initialPageFrameName ?? undefined,
              UserPrefs.get('defaultPageLayout'),
            ),
        );
        frame.setOffset(
          centerWorld.x - frame.totalWidth / 2,
          centerWorld.y - frame.totalHeight / 2,
        );
        frame.updateBounds();
        drawableCanvas.updateBounding();
        await session.save();
      }

      if (this.shouldAbortOpen(token)) {
        await this.cleanupAbandonedSession(session, drawableCanvas);
        return;
      }

      this.attachSession(session, drawableCanvas, {
        fileName: node?.type === 'file' ? node.name : '',
      });
    } catch (error) {
      await this.cleanupAbandonedSession(session, drawableCanvas);

      if (this.shouldAbortOpen(token)) {
        return;
      }

      logger.error('Failed to open canvas session', error, { id: noteId });
      this.setLifecycleError(error);
    }
  }

  private handlePageFrameRenamed(
    ownerNoteId: VFSNodeId,
    pageFrameId: string,
    newName: string,
  ): void {
    const drawableCanvas = this.activeSession?.drawableCanvas;
    if (drawableCanvas) {
      for (const element of drawableCanvas.elements) {
        if (!(element instanceof PageFrameElement)) {
          continue;
        }
        const view = element.pmEditor?.view;
        if (!view) {
          continue;
        }
        const result = buildRenamePageFrameLinkReferencesTransaction(
          view.state,
          pageFrameSchema,
          pageFrameId,
          newName,
        );
        if (result) {
          view.dispatch(result.tr);
        }
      }
    }

    this.onPageFrameRenamed?.(ownerNoteId, pageFrameId, newName);
  }

  private async teardownActiveSession(): Promise<void> {
    const runTeardown = async () => {
      const activeSession = this.activeSession;
      this.activeSession = null;
      this.drawableCanvasRef.current = null;

      this.updateSnapshot({
        ...EMPTY_SNAPSHOT,
        error: this.lifecycleError,
      });

      if (!activeSession) {
        return;
      }

      activeSession.unsubscribeStatus();
      activeSession.drawableCanvas.destroy();

      try {
        await activeSession.noteSession.close();
      } catch (error) {
        logger.error('Failed to close canvas session', error, {
          id: activeSession.noteSession.id,
        });
        this.setLifecycleError(error);
      }
    };

    this.teardownQueue = this.teardownQueue.then(runTeardown, runTeardown);
    await this.teardownQueue;
  }

  private updateSnapshot(
    patch: Partial<CanvasSessionSnapshot> | CanvasSessionSnapshot,
  ): void {
    this.snapshot =
      patch === EMPTY_SNAPSHOT
        ? EMPTY_SNAPSHOT
        : {
            ...this.snapshot,
            ...patch,
          };

    for (const listener of this.listeners) {
      listener();
    }
  }

  private setLifecycleError(error: unknown): void {
    this.lifecycleError =
      error instanceof Error ? error : new Error(String(error));
    this.updateSnapshot({
      error: this.lifecycleError,
    });
  }

  private shouldAbortOpen(token: number): boolean {
    return token !== this.lifecycleToken;
  }

  private attachSession(
    noteSession: NoteSession,
    drawableCanvas: DrawableCanvas,
    options: { fileName: string },
  ): void {
    this.lifecycleError = null;
    let unsubscribeStatus = () => {};

    this.activeSession = {
      noteSession,
      drawableCanvas,
      unsubscribeStatus: () => unsubscribeStatus(),
    };
    this.drawableCanvasRef.current = drawableCanvas;

    unsubscribeStatus = noteSession.subscribeStatus((status) => {
      if (this.activeSession?.noteSession !== noteSession) {
        return;
      }

      this.updateSnapshot({
        status,
        error: this.lifecycleError ?? status.lastError,
      });
    });

    this.updateSnapshot({
      noteSession,
      ydoc: noteSession.ydoc,
      fileName: options.fileName,
      error: null,
      ready: true,
    });
  }

  private async cleanupAbandonedSession(
    noteSession: NoteSession | null,
    drawableCanvas: DrawableCanvas | null = null,
  ): Promise<void> {
    drawableCanvas?.destroy();

    if (!noteSession) {
      return;
    }

    try {
      await noteSession.close();
    } catch (error) {
      logger.error('Failed to close abandoned canvas session', error, {
        id: noteSession.id,
      });
    }
  }
}

interface UseCanvasSessionControllerArgs {
  id: VFSNodeId | undefined;
  initialPageFrameName?: string | null;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  bgCanvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  domOverlayRef: RefObject<HTMLDivElement | null>;
  drawableCanvasRef: RefObject<DrawableCanvas | null>;
  canvasTools: ITool[];
}

export function useCanvasSessionController({
  id,
  initialPageFrameName,
  canvasRef,
  bgCanvasRef,
  overlayCanvasRef,
  domOverlayRef,
  drawableCanvasRef,
  canvasTools,
}: UseCanvasSessionControllerArgs) {
  const repository = useRepository();

  const canvasToolsRef = useRef(canvasTools);
  canvasToolsRef.current = canvasTools;

  const controller = useMemo(
    () =>
      new CanvasSessionController(
        repository,
        canvasRef,
        bgCanvasRef,
        overlayCanvasRef,
        domOverlayRef,
        drawableCanvasRef,
        canvasToolsRef,
      ),
    [
      bgCanvasRef,
      canvasRef,
      domOverlayRef,
      drawableCanvasRef,
      overlayCanvasRef,
      repository,
    ],
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  const initialPageFrameNameRef = useRef(initialPageFrameName);
  initialPageFrameNameRef.current = initialPageFrameName;

  useEffect(() => {
    if (!id) {
      void controller.dispose();
      return;
    }

    void controller.open(id, {
      initialPageFrameName: initialPageFrameNameRef.current,
    });

    return () => {
      void controller.dispose();
    };
  }, [controller, id]);

  const [pageFrameRenamePrompt, setPageFrameRenamePrompt] =
    useState<PendingPageFrameRenamePrompt | null>(null);
  const pendingRenamesRef = useRef(new Map<string, PendingPageFrameRename>());
  const drainingRef = useRef(false);

  const drainPendingRenames = useCallback(async () => {
    if (drainingRef.current) {
      return;
    }
    drainingRef.current = true;
    try {
      while (pendingRenamesRef.current.size > 0) {
        const next = pendingRenamesRef.current.entries().next();
        if (next.done) {
          break;
        }
        const [pageFrameId, { ownerNoteId, newName, backlinks }] = next.value;
        pendingRenamesRef.current.delete(pageFrameId);
        try {
          await renamePageFrameReferences(
            repository,
            ownerNoteId,
            pageFrameId,
            newName,
            backlinks,
          );
        } catch (error) {
          logger.error('Failed to rename page-frame references', error, {
            ownerNoteId,
            pageFrameId,
          });
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, [repository]);

  const enqueueAndDrain = useCallback(
    (entry: PendingPageFrameRename & { pageFrameId: string }) => {
      pendingRenamesRef.current.set(entry.pageFrameId, {
        ownerNoteId: entry.ownerNoteId,
        newName: entry.newName,
        backlinks: entry.backlinks,
      });
      void drainPendingRenames();
    },
    [drainPendingRenames],
  );

  useEffect(() => {
    controller.setOnPageFrameRenamed((ownerNoteId, pageFrameId, newName) => {
      void (async () => {
        let backlinks: NoteBacklink[] = [];
        try {
          backlinks = await repository.getBacklinks(ownerNoteId);
        } catch (err) {
          logger.error(
            'Failed to load backlinks before page-frame rename',
            err,
            { ownerNoteId, pageFrameId },
          );
        }

        const matching = backlinks.filter(
          (b) =>
            b.targetId === ownerNoteId &&
            b.pageFrameId === pageFrameId &&
            b.sourceId !== ownerNoteId,
        );

        if (matching.length === 0) {
          return;
        }

        if (UserPrefs.get('alwaysRenameNoteReferences')) {
          enqueueAndDrain({
            pageFrameId,
            ownerNoteId,
            newName,
            backlinks: matching,
          });
          return;
        }

        const noteCount = new Set(matching.map((b) => b.sourceId)).size;
        setPageFrameRenamePrompt({
          ownerNoteId,
          pageFrameId,
          newName,
          backlinks: matching,
          mentionCount: matching.length,
          noteCount,
        });
      })();
    });
    return () => {
      controller.setOnPageFrameRenamed(null);
    };
  }, [controller, repository, enqueueAndDrain]);

  const lastIdRef = useRef(id);
  if (lastIdRef.current !== id) {
    lastIdRef.current = id;
    if (pageFrameRenamePrompt !== null) {
      setPageFrameRenamePrompt(null);
    }
  }

  const restoreVersion = useCallback(
    async (bytes: Uint8Array) => {
      if (!id) {
        return;
      }
      await controller.restoreVersion(id, bytes);
    },
    [controller, id],
  );

  const choosePageFrameRenameReferences = useCallback(
    (choice: RenameReferencesChoice) => {
      const pending = pageFrameRenamePrompt;
      if (!pending) {
        return;
      }
      setPageFrameRenamePrompt(null);
      if (choice === 'cancel' || choice === 'no') {
        return;
      }
      if (choice === 'always') {
        UserPrefs.set('alwaysRenameNoteReferences', true);
      }
      enqueueAndDrain({
        pageFrameId: pending.pageFrameId,
        ownerNoteId: pending.ownerNoteId,
        newName: pending.newName,
        backlinks: pending.backlinks,
      });
    },
    [pageFrameRenamePrompt, enqueueAndDrain],
  );

  return {
    ...snapshot,
    pageFrameRenamePrompt: pageFrameRenamePrompt
      ? {
          mentionCount: pageFrameRenamePrompt.mentionCount,
          noteCount: pageFrameRenamePrompt.noteCount,
        }
      : null,
    choosePageFrameRenameReferences,
    restoreVersion,
  };
}
