import {
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { Logger } from '@/lib/logger';
import type { FileId, NoteSession } from '@/lib/sync';
import {
  type ActiveRepository,
  type NoteSessionStatus,
  useRepository,
} from '@/lib/sync';
import { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import { PageFrameElement } from '@/pages/canvas/elements/page-frame-element';
import { resolveNoteLinkIdByTitle } from '@/pages/canvas/page-frame/note-link-resolution';
import type { ITool } from '@/pages/canvas/tools/tool';
import type { YDocManager } from '@/pages/canvas/ydoc-manager';

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

  async open(noteId: FileId): Promise<void> {
    const token = ++this.lifecycleToken;
    await this.teardownActiveSession();
    if (token !== this.lifecycleToken) {
      return;
    }
    await this.openSession(noteId, token);
  }

  async dispose(): Promise<void> {
    this.lifecycleToken += 1;
    await this.teardownActiveSession();
  }

  private async openSession(noteId: FileId, token: number): Promise<void> {
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

      drawableCanvas = new DrawableCanvas(
        canvas,
        session.ydoc,
        this.canvasToolsRef.current,
        async (title) => resolveNoteLinkIdByTitle(this.repository, title),
      );

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
          (uuid) => new PageFrameElement(uuid),
        );
        frame.setOffset(
          centerWorld.x - frame.pageWidth / 2,
          centerWorld.y - frame.pageHeight / 2,
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
  id: FileId | undefined;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  bgCanvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  domOverlayRef: RefObject<HTMLDivElement | null>;
  drawableCanvasRef: RefObject<DrawableCanvas | null>;
  canvasTools: ITool[];
}

export function useCanvasSessionController({
  id,
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

  useEffect(() => {
    if (!id) {
      void controller.dispose();
      return;
    }

    void controller.open(id);

    return () => {
      void controller.dispose();
    };
  }, [controller, id]);

  return snapshot;
}
