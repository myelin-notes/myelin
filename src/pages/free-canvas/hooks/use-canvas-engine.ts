import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WheelPickerHandle } from '@/components/wheel-picker';
import { keybindings, registry } from '@/lib/keybinds';
import { type RepositoryNoteHandle, repository } from '@/lib/repository';
import {
  DrawableCanvas,
  type Vector2,
} from '@/pages/free-canvas/drawable-canvas';
import type { DrawableElement } from '@/pages/free-canvas/elements/drawable-element';
import { PageFrameElement } from '@/pages/free-canvas/elements/page-frame-element';
import type { ITool } from '@/pages/free-canvas/tools/tool';
import { YDocManager } from '@/pages/free-canvas/ydoc-manager';

declare module '@/lib/keybinds' {
  interface ActionMap {
    'canvas:pan': true;
    'canvas:undo': true;
    'canvas:redo': true;
    'canvas:delete': true;
    'canvas:tool-text': true;
  }
}

registry.defineDefaults({
  'canvas:pan': { key: ' ' },
  'canvas:undo': { key: 'z', mod: true },
  'canvas:redo': { key: 'z', mod: true, shift: true },
  'canvas:delete': { key: 'Backspace' },
  'canvas:tool-text': { key: 't' },
});

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<RepositoryNoteHandle | null>(null);
  const pendingEmbedPos = useRef<Vector2 | null>(null);
  const onCanvasPointerDownRef = useRef(onCanvasPointerDown);
  onCanvasPointerDownRef.current = onCanvasPointerDown;

  const navigate = useNavigate();
  const [zoomLevel, setZoomLevel] = useState(100);
  const [fps, setFps] = useState(0);
  const [fileName, setFileName] = useState('');
  const [editingElement, setEditingElement] = useState<DrawableElement | null>(
    null,
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
    const note = noteRef.current;
    if (!(drawableCanvasRef.current && canvasRef.current && note)) {
      return;
    }
    const ydoc = drawableCanvasRef.current.ydoc;
    const data = ydoc.encodeState();
    await note.save(data);
    await new Promise<void>((resolve, reject) => {
      canvasRef.current!.toBlob(async (b) => {
        if (b === null) {
          console.warn('Failed to generate thumbnail');
          reject();
          return;
        }
        await note.saveThumbnail(b);
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
      noteRef.current = null;
      return;
    }
    repository
      .openNote(id)
      .then(async (note) => {
        noteRef.current = note;
        const name = await note.getName();
        if (name) {
          setFileName(name);
        }
      })
      .catch(console.error);
  }, [id]);

  // Initialize canvas, event listeners, animation loop, and keybindings
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!(canvas && id)) {
      return;
    }

    let disposed = false;
    noteRef.current = null;

    const handleContextMenu = (evt: MouseEvent) => {
      if (evt.shiftKey) {
        return;
      }
      evt.preventDefault();
    };
    canvas.addEventListener('contextmenu', handleContextMenu);

    const handleCanvasPointerDown = (evt: PointerEvent) => {
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
    canvas.addEventListener('pointerdown', handleCanvasPointerDown);

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

    // Load or create Y.Doc, then build canvas
    repository
      .openNote(id)
      .then(async (note) => {
        noteRef.current = note;
        const bytes = await note.load();
        if (disposed) {
          return;
        }

        const ydoc = bytes ? YDocManager.fromUpdate(bytes) : new YDocManager();

        const dc = new DrawableCanvas(canvas, ydoc, canvasTools);
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

        // If no elements, create default PageFrame
        if (dc.elements.length === 0) {
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

        // Initial save to persist the Y.Doc state
        note.save(dc.ydoc.encodeState()).catch(console.error);

        // Start animation loop
        let prevTime = 0;
        let fpsAccum = 0;
        let fpsFrames = 0;

        function animate(time: number) {
          if (disposed) {
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

          animationFrameId = requestAnimationFrame(animate);
        }

        animationFrameId = requestAnimationFrame(animate);
      })
      .catch(console.error);

    let animationFrameId = 0;

    const unbindKeys = keybindings.register([
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

    return () => {
      disposed = true;
      noteRef.current = null;
      cancelAnimationFrame(animationFrameId);
      unbindKeys();
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('pointerdown', handleCanvasPointerDown);
      canvas.removeEventListener('dragover', handleDragOver);
      canvas.removeEventListener('drop', handleDrop);
      document.removeEventListener('paste', handlePaste);
      drawableCanvasRef.current?.destroy();
    };
  }, [id]);

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
    zoomLevel,
    fps,
    fileName,
    editingElement,
    back,
    handleFileInputChange,
  };
}
