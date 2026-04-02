import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WheelPickerHandle } from '@/components/wheel-picker';
import { keybindings } from '@/lib/keybindings';
import { FileSystem } from '@/lib/utils/file-system';
import {
  DrawableCanvas,
  type Vector2,
} from '@/pages/free-canvas/drawable-canvas';
import { PageFrameElement } from '@/pages/free-canvas/elements/page-frame-element';
import type { ITool } from '@/pages/free-canvas/tools/tool';
import type { EditableBlock } from '../page-frame/block-editor';

declare module '@/lib/keybindings' {
  interface ActionMap {
    'canvas:pan': true;
    'canvas:undo': true;
    'canvas:redo': true;
    'canvas:delete': true;
    'canvas:tool-text': true;
  }
}

export interface TextEditState {
  screenPos: Vector2;
  screenFontSize: number;
  fontFamily: string;
  initialText: string;
  boxScreenWidth: number;
  boxScreenHeight: number;
  onCommit: (text: string) => void;
}

interface UseCanvasEngineArgs {
  id: string | undefined;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  wheelRef: React.RefObject<WheelPickerHandle | null>;
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>;
  canvasTools: ITool[];
  setSelectedToolIndex: (i: number) => void;
  onCanvasPointerDown: () => void;
}

export function useCanvasEngine({
  id,
  canvasRef,
  wheelRef,
  drawableCanvasRef,
  canvasTools,
  setSelectedToolIndex,
  onCanvasPointerDown,
}: UseCanvasEngineArgs) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingEmbedPos = useRef<Vector2 | null>(null);
  const onCanvasPointerDownRef = useRef(onCanvasPointerDown);
  onCanvasPointerDownRef.current = onCanvasPointerDown;

  const [zoomLevel, setZoomLevel] = useState(100);
  const [fps, setFps] = useState(0);
  const [fileName, setFileName] = useState('');
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const [editingPageFrame, setEditingPageFrame] =
    useState<PageFrameElement | null>(null);

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
    if (!(drawableCanvasRef.current && canvasRef.current && id)) {
      return;
    }
    await FileSystem.saveToFile(id, drawableCanvasRef.current);
    await new Promise<void>((resolve, reject) => {
      canvasRef.current!.toBlob(async (b) => {
        if (b === null) {
          console.warn('Failed to generate thumbnail');
          reject();
          return;
        }
        await FileSystem.saveThumbnail(id, b);
        resolve();
      }, 'image/png');
    });
  };

  const navigate = useNavigate();

  const back = async () => {
    await autoSave();
    drawableCanvasRef.current?.collapse();
    navigate('/library');
  };

  // Load file name
  useEffect(() => {
    if (!id) {
      return;
    }
    FileSystem.getNodeFileName(id).then((name) => {
      if (name) {
        setFileName(name);
      }
    });
  }, [id]);

  // Initialize canvas, event listeners, animation loop, and keybindings
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!(canvas && id)) {
      return;
    }

    let disposed = false;

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

    const dc = new DrawableCanvas(canvas, canvasTools);
    drawableCanvasRef.current = dc;

    dc.setOnZoomChange((zoom) => setZoomLevel(Math.round(zoom * 100)));

    dc.setOnRequestTextEdit(
      (
        screenPos,
        screenFontSize,
        fontFamily,
        initialText,
        boxScreenWidth,
        boxScreenHeight,
        onCommit,
      ) => {
        setTextEdit({
          screenPos,
          screenFontSize,
          fontFamily,
          initialText,
          boxScreenWidth,
          boxScreenHeight,
          onCommit,
        });
      },
    );

    dc.setOnRequestFilePick((screenPos) => {
      pendingEmbedPos.current = screenPos;
      fileInputRef.current?.click();
    });

    dc.setOnPageFrameEdit((element) => {
      setEditingPageFrame(element);
    });

    let prevTime = 0;
    let animationFrameId: number;
    let fpsAccum = 0;
    let fpsFrames = 0;

    function animate(time: number) {
      const dt = (time - prevTime) / 1000;
      prevTime = time;
      dc.redraw(dt);

      // Throttle fps state updates to ~2/sec to avoid re-rendering every frame
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

    keybindings.defineDefaults({
      'canvas:pan': { key: ' ' },
      'canvas:undo': { key: 'z', mod: true },
      'canvas:redo': { key: 'z', mod: true, shift: true },
      'canvas:delete': { key: 'Backspace' },
      'canvas:tool-text': { key: 't' },
    });

    const unbindKeys = keybindings.register([
      {
        action: 'canvas:pan',
        onDown: () => dc.setSpaceDown(true),
        onUp: () => dc.setSpaceDown(false),
      },
      { action: 'canvas:undo', onDown: () => dc.undo() },
      { action: 'canvas:redo', onDown: () => dc.redo() },
      { action: 'canvas:delete', onDown: () => dc.deleteSelected() },
      {
        action: 'canvas:tool-text',
        onDown: () => {
          dc.switchTool(4);
          setSelectedToolIndex(4);
        },
      },
    ]);

    FileSystem.loadFromFile(id, dc)
      .then(() => {
        // Guard against StrictMode double-fire: if this effect was
        // cleaned up before the async load finished, bail out.
        if (disposed) {
          return;
        }
        // Auto-create a page frame for empty canvases
        if (dc.elements.length === 0) {
          const dpr = window.devicePixelRatio || 1;
          const centerWorld = dc.screenToWorld({
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
        return FileSystem.saveToFile(id, dc);
      })
      .catch(console.error);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrameId);
      unbindKeys();
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('pointerdown', handleCanvasPointerDown);
      canvas.removeEventListener('dragover', handleDragOver);
      canvas.removeEventListener('drop', handleDrop);
      document.removeEventListener('paste', handlePaste);
      dc.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id is the only
    // real dependency; canvasRef.current is always set before the first effect
    // runs and the guard above handles the null case.
  }, [id]);

  const commitPageFrameEdit = (blocks: EditableBlock[]) => {
    drawableCanvasRef.current?.exitPageFrameEdit(blocks);
  };

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
    textEdit,
    setTextEdit,
    editingPageFrame,
    commitPageFrameEdit,
    back,
    handleFileInputChange,
  };
}
