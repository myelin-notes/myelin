import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WheelPickerHandle } from '@/components/wheel-picker';
import { useKeybindings } from '@/hooks/useKeybindings';
import { type NoteSession, useBeforeShutdown, useRepository } from '@/lib/sync';
import { ThumbnailCache } from '@/lib/thumbnail-cache';
import {
  DrawableCanvas,
  type Vector2,
} from '@/pages/free-canvas/drawable-canvas';
import type { DrawableElement } from '@/pages/free-canvas/elements/drawable-element';
import { PageFrameElement } from '@/pages/free-canvas/elements/page-frame-element';
import type { ITool } from '@/pages/free-canvas/tools/tool';
import type { YDocManager } from '@/pages/free-canvas/ydoc-manager';

function setupCanvasListeners(
  canvas: HTMLCanvasElement,
  wheelRef: React.RefObject<WheelPickerHandle | null>,
  onCanvasPointerDownRef: React.RefObject<() => void>,
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
    onCanvasPointerDownRef.current();
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
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
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

interface UseCanvasEngineArgs {
  id: string | undefined;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  bgCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  wheelRef: React.RefObject<WheelPickerHandle | null>;
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>;
  canvasTools: ITool[];
  setSelectedToolIndex: (i: number) => void;
  onCanvasPointerDown: () => void;
}

export function useCanvasEngine({
  id,
  canvasRef,
  bgCanvasRef,
  wheelRef,
  drawableCanvasRef,
  canvasTools,
  setSelectedToolIndex,
  onCanvasPointerDown,
}: UseCanvasEngineArgs) {
  const repository = useRepository();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const noteSessionRef = useRef<NoteSession | null>(null);
  const pendingEmbedPos = useRef<Vector2 | null>(null);
  const onCanvasPointerDownRef = useRef(onCanvasPointerDown);
  onCanvasPointerDownRef.current = onCanvasPointerDown;

  const navigate = useNavigate();
  const [zoomLevel, setZoomLevel] = useState(100);
  const [fps, setFps] = useState(0);
  const [fileName, setFileName] = useState('');
  const [noteSession, setNoteSession] = useState<NoteSession | null>(null);
  const [ydoc, setYdoc] = useState<YDocManager | null>(null);
  const [editingElement, setEditingElement] = useState<DrawableElement | null>(
    null,
  );

  useBeforeShutdown(
    async () => {
      const session = noteSessionRef.current;
      noteSessionRef.current = null;
      await session?.close();
    },
    {
      shouldBlock: () => noteSessionRef.current?.hasLocalChanges() ?? false,
    },
  );

  const embedFiles = (
    files: FileList | File[],
    screenX?: number,
    screenY?: number,
  ) => {
    const dc = drawableCanvasRef.current;
    if (!dc) {
      return;
    }
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        dc.addImageFromBlob(file, screenX, screenY);
      }
    }
  };

  const autoSave = async () => {
    const session = noteSessionRef.current;
    if (!(drawableCanvasRef.current && canvasRef.current && session && id)) {
      return;
    }
    await session.push();
    await new Promise<void>((resolve, reject) => {
      canvasRef.current!.toBlob(async (b) => {
        if (b === null) {
          console.warn('Failed to generate thumbnail');
          reject();
          return;
        }
        await ThumbnailCache.save(id, b);
        resolve();
      }, 'image/png');
    });
  };

  const back = async () => {
    await autoSave();
    navigate('/library');
  };

  // Load file name
  useEffect(() => {
    if (!id) {
      noteSessionRef.current = null;
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
      .catch(console.error);
  }, [id, repository]);

  // Initialize canvas, event listeners, and animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!(canvas && id)) {
      return;
    }

    let disposed = false;
    const priorSession = noteSessionRef.current;
    noteSessionRef.current = null;
    void priorSession?.close().catch(console.error);

    const removeListeners = setupCanvasListeners(
      canvas,
      wheelRef,
      onCanvasPointerDownRef,
      embedFiles,
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

        const dc = new DrawableCanvas(canvas, session.ydoc, canvasTools);
        drawableCanvasRef.current = dc;

        if (bgCanvasRef.current) {
          dc.setBackgroundCanvas(bgCanvasRef.current);
        }

        dc.viewport.setOnZoomChange((zoom) =>
          setZoomLevel(Math.round(zoom * 100)),
        );

        dc.setOnRequestFilePick((screenPos) => {
          pendingEmbedPos.current = screenPos;
          fileInputRef.current?.click();
        });

        dc.setOnElementEdit((element) => {
          setEditingElement(element);
        });

        // Only create default PageFrame for notes that exist locally.
        // Peer-joined sessions (note doesn't exist locally) will receive
        // elements from the remote peer.
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

        session.push().catch(console.error);
        stopAnimation = startAnimationLoop(dc, setFps, () => disposed);
      })
      .catch(console.error);

    return () => {
      disposed = true;
      const session = noteSessionRef.current;
      noteSessionRef.current = null;
      void session?.close().catch(console.error);
      stopAnimation();
      removeListeners();
      drawableCanvasRef.current?.destroy();
    };
  }, [id, repository]);

  useKeybindings([
    {
      action: 'canvas:pan',
      onDown: () => drawableCanvasRef.current?.setSpaceDown(true),
      onUp: () => drawableCanvasRef.current?.setSpaceDown(false),
    },
    {
      action: 'canvas:undo',
      onDown: () => drawableCanvasRef.current?.undo(),
    },
    {
      action: 'canvas:redo',
      onDown: () => drawableCanvasRef.current?.redo(),
    },
    {
      action: 'canvas:delete',
      onDown: () => drawableCanvasRef.current?.deleteSelected(),
    },
    {
      action: 'canvas:tool-text',
      onDown: () => {
        drawableCanvasRef.current?.switchTool(4);
        setSelectedToolIndex(4);
      },
    },
  ]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files?.length) {
      embedFiles(
        Array.from(files),
        pendingEmbedPos.current?.x,
        pendingEmbedPos.current?.y,
      );
    }
    e.currentTarget.value = '';
    pendingEmbedPos.current = null;
  };

  return {
    fileInputRef,
    drawableCanvasRef,
    noteSession,
    ydoc,
    zoomLevel,
    fps,
    fileName,
    editingElement,
    back,
    handleFileInputChange,
  };
}
