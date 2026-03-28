import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { DrawableCanvas, Vector2 } from "@/pages/free-canvas/drawable-canvas";
import { PageFrameElement } from "@/pages/free-canvas/elements/page-frame-element";
import { ITool } from "@/pages/free-canvas/tools/tool";
import { WheelPickerHandle } from "@/components/wheel-picker";
import { FileSystem } from "@/lib/utils/file-system";
import { keybindings } from "@/lib/keybindings";

declare module "@/lib/keybindings" {
  interface ActionMap {
    "canvas:pan": true;
    "canvas:undo": true;
    "canvas:redo": true;
    "canvas:delete": true;
    "canvas:tool-text": true;
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
}

export function useCanvasEngine({
  id,
  canvasRef,
  wheelRef,
  drawableCanvasRef,
  canvasTools,
  setSelectedToolIndex,
}: UseCanvasEngineArgs) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingEmbedPos = useRef<Vector2 | null>(null);

  const [zoomLevel, setZoomLevel] = useState(100);
  const [fps, setFps] = useState(0);
  const [fileName, setFileName] = useState("");
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const hiddenTextareaRef = useRef<HTMLTextAreaElement>(null);

  const embedFiles = useCallback((files: FileList | File[], screenX?: number, screenY?: number) => {
    const dc = drawableCanvasRef.current;
    if (!dc) return;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        dc.addImageFromBlob(file, screenX, screenY);
      }
    }
  }, [drawableCanvasRef]);

  const autoSave = useCallback(async () => {
    if (!drawableCanvasRef.current || !canvasRef.current || !id) return;
    await FileSystem.saveToFile(id, drawableCanvasRef.current);
    await new Promise<void>((resolve, reject) => {
      canvasRef.current!.toBlob(async (b) => {
        if (b === null) {
          console.warn("Failed to generate thumbnail");
          reject();
          return;
        }
        await FileSystem.saveThumbnail(id, b);
        resolve();
      }, "image/png");
    });
  }, [id, drawableCanvasRef, canvasRef]);

  const navigate = useNavigate();

  const back = useCallback(async () => {
    await autoSave();
    drawableCanvasRef.current?.collapse();
    navigate("/library");
  }, [autoSave, navigate, drawableCanvasRef]);

  // Load file name
  useEffect(() => {
    if (!id) return;
    FileSystem.getNodeFileName(id).then((name) => {
      if (name) setFileName(name);
    });
  }, [id]);

  // Initialize canvas, event listeners, animation loop, and keybindings
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !id) return;

    canvas.addEventListener("contextmenu", (evt) => {
      if (evt.shiftKey) return;
      evt.preventDefault();
    });

    canvas.addEventListener("pointerdown", (evt) => {
      if (evt.shiftKey) return;
      if (evt.pointerType === "mouse") {
        if (evt.button === 2) {
          wheelRef.current?.show(evt);
        } else {
          wheelRef.current?.hide();
        }
      }
    });

    canvas.addEventListener("dragover", (evt) => evt.preventDefault());

    canvas.addEventListener("drop", (evt) => {
      evt.preventDefault();
      if (evt.dataTransfer?.files?.length) {
        embedFiles(Array.from(evt.dataTransfer.files), evt.pageX, evt.pageY);
      }
    });

    const handlePaste = (evt: ClipboardEvent) => {
      const items = evt.clipboardData?.items;
      if (!items) return;
      const blobs: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) blobs.push(file);
        }
      }
      if (blobs.length > 0) {
        evt.preventDefault();
        embedFiles(blobs);
      }
    };
    document.addEventListener("paste", handlePaste);

    const dc = new DrawableCanvas(canvas, canvasTools);
    drawableCanvasRef.current = dc;

    dc.setOnZoomChange((zoom) => setZoomLevel(Math.round(zoom * 100)));

    dc.setOnRequestTextEdit((screenPos, screenFontSize, fontFamily, initialText, boxScreenWidth, boxScreenHeight, onCommit) => {
      setTextEdit({ screenPos, screenFontSize, fontFamily, initialText, boxScreenWidth, boxScreenHeight, onCommit });
    });

    dc.setOnRequestFilePick((screenPos) => {
      pendingEmbedPos.current = screenPos;
      fileInputRef.current?.click();
    });

    // Wire up hidden textarea for canvas-based page frame editing
    if (hiddenTextareaRef.current) {
      dc.setHiddenTextarea(hiddenTextareaRef.current);
    }

    let prevTime = 0;
    let animationFrameId: number;

    function animate(time: number) {
      const dt = (time - prevTime) / 1000;
      prevTime = time;
      dc.redraw(dt);
      setFps(dt > 0 ? Math.round(1 / dt) : 0);
      animationFrameId = requestAnimationFrame(animate);
    }

    animationFrameId = requestAnimationFrame(animate);

    keybindings.defineDefaults({
      "canvas:pan": { key: " " },
      "canvas:undo": { key: "z", mod: true },
      "canvas:redo": { key: "z", mod: true, shift: true },
      "canvas:delete": { key: "Backspace" },
      "canvas:tool-text": { key: "t" },
    });

    const unbindKeys = keybindings.register([
      { action: "canvas:pan", onDown: () => dc.setSpaceDown(true), onUp: () => dc.setSpaceDown(false) },
      { action: "canvas:undo", onDown: () => dc.undo() },
      { action: "canvas:redo", onDown: () => dc.redo() },
      { action: "canvas:delete", onDown: () => dc.deleteSelected() },
      { action: "canvas:tool-text", onDown: () => { dc.switchTool(4); setSelectedToolIndex(4); } },
    ]);

    FileSystem.loadFromFile(id, dc)
      .then(() => {
        // Auto-create a page frame for empty canvases
        if (dc.elements.length === 0) {
          const dpr = window.devicePixelRatio || 1;
          const centerWorld = dc.screenToWorld({
            x: canvas.width / dpr / 2,
            y: canvas.height / dpr / 2,
          });
          const frame = dc.addElement(i => new PageFrameElement(i));
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
      cancelAnimationFrame(animationFrameId);
      unbindKeys();
      document.removeEventListener("paste", handlePaste);
      dc.destroy();
    };
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files?.length) {
      embedFiles(Array.from(files), pendingEmbedPos.current?.x, pendingEmbedPos.current?.y);
    }
    e.currentTarget.value = "";
    pendingEmbedPos.current = null;
  }, [embedFiles]);

  return {
    fileInputRef,
    hiddenTextareaRef,
    zoomLevel,
    fps,
    fileName,
    textEdit,
    setTextEdit,
    back,
    handleFileInputChange,
  };
}
