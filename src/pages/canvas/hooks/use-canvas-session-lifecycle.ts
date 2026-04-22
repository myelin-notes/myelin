import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { WheelPickerHandle } from '@/components/wheel-picker';
import { Logger } from '@/lib/logger';
import { type NoteSession, useRepository } from '@/lib/sync';
import { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import type { DrawableElement } from '@/pages/canvas/elements/drawable-element';
import { PageFrameElement } from '@/pages/canvas/elements/page-frame-element';
import type { ITool } from '@/pages/canvas/tools/tool';
import type { YDocManager } from '@/pages/canvas/ydoc-manager';

const logger = new Logger('CanvasSessionLifecycle');

function setupCanvasListeners(
  canvas: HTMLCanvasElement,
  wheelRef: React.RefObject<WheelPickerHandle | null>,
  onCanvasPointerDown: () => void,
  embedFiles: (
    files: FileList | File[],
    screenX?: number,
    screenY?: number,
  ) => void,
) {
  const handleContextMenu = (evt: MouseEvent) => {
    if (evt.shiftKey) {
      return;
    }
    evt.preventDefault();
  };
  canvas.addEventListener('contextmenu', handleContextMenu);

  const handlePointerDown = (evt: PointerEvent) => {
    onCanvasPointerDown();
    if (evt.shiftKey) {
      return;
    }
    if (evt.pointerType === 'mouse') {
      if (evt.button === 2) {
        wheelRef.current?.show(evt);
      } else {
        wheelRef.current?.hide();
      }
    }
  };
  canvas.addEventListener('pointerdown', handlePointerDown);

  const handleDragOver = (evt: DragEvent) => evt.preventDefault();
  canvas.addEventListener('dragover', handleDragOver);

  const handleDrop = (evt: DragEvent) => {
    evt.preventDefault();
    if (evt.dataTransfer?.files?.length) {
      embedFiles(Array.from(evt.dataTransfer.files), evt.pageX, evt.pageY);
    }
  };
  canvas.addEventListener('drop', handleDrop);

  const handlePaste = (evt: ClipboardEvent) => {
    const items = evt.clipboardData?.items;
    if (!items) {
      return;
    }
    const blobs: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/') || item.type === 'application/pdf') {
        const file = item.getAsFile();
        if (file) {
          blobs.push(file);
        }
      }
    }
    if (blobs.length > 0) {
      evt.preventDefault();
      embedFiles(blobs);
    }
  };
  document.addEventListener('paste', handlePaste);

  return () => {
    canvas.removeEventListener('contextmenu', handleContextMenu);
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('dragover', handleDragOver);
    canvas.removeEventListener('drop', handleDrop);
    document.removeEventListener('paste', handlePaste);
  };
}

function startAnimationLoop(
  dc: DrawableCanvas,
  setFps: (fps: number) => void,
  isDisposed: () => boolean,
) {
  let prevTime = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let frameId = 0;

  function animate(time: number) {
    if (isDisposed()) {
      return;
    }
    const dt = (time - prevTime) / 1000;
    prevTime = time;
    dc.redraw(dt);

    if (dt > 0) {
      fpsAccum += dt;
      fpsFrames++;
      if (fpsAccum >= 0.5) {
        setFps(Math.round(fpsFrames / fpsAccum));
        fpsAccum = 0;
        fpsFrames = 0;
      }
    }

    frameId = requestAnimationFrame(animate);
  }

  frameId = requestAnimationFrame(animate);
  return () => cancelAnimationFrame(frameId);
}

interface UseCanvasSessionLifecycleArgs {
  id: string | undefined;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  bgCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  domOverlayRef: React.RefObject<HTMLDivElement | null>;
  wheelRef: React.RefObject<WheelPickerHandle | null>;
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>;
  canvasTools: ITool[];
  embedFiles: (
    files: FileList | File[],
    screenX?: number,
    screenY?: number,
  ) => void;
  onCanvasPointerDown: () => void;
}

export function useCanvasSessionLifecycle({
  id,
  canvasRef,
  bgCanvasRef,
  overlayCanvasRef,
  domOverlayRef,
  wheelRef,
  drawableCanvasRef,
  canvasTools,
  embedFiles,
  onCanvasPointerDown,
}: UseCanvasSessionLifecycleArgs) {
  const repository = useRepository();
  const noteSessionRef = useRef<NoteSession | null>(null);
  const handleCanvasPointerDown = useEffectEvent(() => {
    onCanvasPointerDown();
  });
  const handleEmbedFiles = useEffectEvent(
    (files: FileList | File[], screenX?: number, screenY?: number) => {
      embedFiles(files, screenX, screenY);
    },
  );

  const [zoomLevel, setZoomLevel] = useState(100);
  const [fps, setFps] = useState(0);
  const [fileName, setFileName] = useState('');
  const [noteSession, setNoteSession] = useState<NoteSession | null>(null);
  const [ydoc, setYdoc] = useState<YDocManager | null>(null);
  const [editingElement, setEditingElement] = useState<DrawableElement | null>(
    null,
  );

  useEffect(() => {
    if (!id) {
      noteSessionRef.current = null;
      setNoteSession(null);
      setYdoc(null);
      setEditingElement(null);
      setFileName('');
      return;
    }
    repository
      .getNode(id)
      .then((node) => {
        if (node?.type === 'file') {
          setFileName(node.name);
          return;
        }
        setFileName('');
      })
      .catch((error) => {
        logger.error('Failed to load note metadata', error, { id });
      });
  }, [id, repository]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!(canvas && id)) {
      return;
    }

    let disposed = false;
    const priorSession = noteSessionRef.current;
    noteSessionRef.current = null;
    setNoteSession(null);
    setYdoc(null);
    setEditingElement(null);
    void priorSession?.close().catch((error) => {
      logger.error('Failed to close prior session', error, { id });
    });

    const removeListeners = setupCanvasListeners(
      canvas,
      wheelRef,
      handleCanvasPointerDown,
      handleEmbedFiles,
    );

    let stopAnimation = () => {};

    repository
      .openSession(id)
      .then(async (session) => {
        if (disposed) {
          await session.close();
          return;
        }

        noteSessionRef.current = session;
        setNoteSession(session);
        setYdoc(session.ydoc);

        const currentNode = await repository.getNode(id);
        if (disposed) {
          await session.close();
          return;
        }
        setFileName(currentNode?.type === 'file' ? currentNode.name : '');

        const dc = new DrawableCanvas(canvas, session.ydoc, canvasTools);
        drawableCanvasRef.current = dc;

        if (bgCanvasRef.current) {
          dc.setBackgroundCanvas(bgCanvasRef.current);
        }
        if (overlayCanvasRef.current) {
          dc.setOverlayCanvas(overlayCanvasRef.current);
        }
        if (domOverlayRef.current) {
          dc.setDomOverlayHost(domOverlayRef.current);
        }

        dc.viewport.setOnZoomChange((zoom) =>
          setZoomLevel(Math.round(zoom * 100)),
        );

        dc.setOnElementEdit((element) => {
          setEditingElement(element);
        });

        const nodeExists = await repository.getNode(id);
        if (dc.elements.length === 0 && nodeExists) {
          const dpr = window.devicePixelRatio || 1;
          const centerWorld = dc.viewport.screenToWorld({
            x: canvas.width / dpr / 2,
            y: canvas.height / dpr / 2,
          });
          const frame = dc.addElement((i) => new PageFrameElement(i));
          frame.setOffset(
            centerWorld.x - frame.pageWidth / 2,
            centerWorld.y - frame.pageHeight / 2,
          );
          frame.updateBounds();
          dc.updateBounding();
        }

        session.push().catch((error) => {
          logger.error('Initial session push failed', error, { id });
        });
        stopAnimation = startAnimationLoop(dc, setFps, () => disposed);
      })
      .catch((error) => {
        logger.error('Failed to open canvas session', error, { id });
      });

    return () => {
      disposed = true;
      const session = noteSessionRef.current;
      noteSessionRef.current = null;
      setNoteSession(null);
      setYdoc(null);
      setEditingElement(null);
      void session?.close().catch((error) => {
        logger.error('Failed to close session during cleanup', error, { id });
      });
      stopAnimation();
      removeListeners();
      drawableCanvasRef.current?.destroy();
    };
  }, [
    id,
    repository,
    canvasRef,
    bgCanvasRef,
    domOverlayRef,
    wheelRef,
    drawableCanvasRef,
    canvasTools,
  ]);

  return {
    noteSession,
    ydoc,
    zoomLevel,
    fps,
    fileName,
    editingElement,
  };
}
