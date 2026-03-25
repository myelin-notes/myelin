import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DrawableCanvas } from "@/pages/free-canvas/drawable-canvas";
import { ITool } from "@/pages/free-canvas/tools/tool";
import { WheelPicker, WheelPickerHandle, WheelItem } from "@/components/wheel-picker";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronLeft as ChevronLeftIcon, X as XIcon } from "lucide-react";
import { Vector2 } from "@/pages/free-canvas/drawable-canvas";

function toolToWheelItem(
  getCanvas: () => DrawableCanvas | null,
  tool: ITool,
  index: number,
  setSelectedToolIndex: (i: number) => void
): WheelItem {
  return {
    label: tool.label,
    icon: tool.icon,
    command: () => {
      getCanvas()?.switchTool(index);
      setSelectedToolIndex(index);
    },
  };
}

const glassPanel = "backdrop-blur-xl bg-white/80 border border-white/50 rounded-xl shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)]";

export function CanvasView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wheelRef = useRef<WheelPickerHandle>(null);
  const drawableCanvasRef = useRef<DrawableCanvas | null>(null);

  const [selectedToolIndex, setSelectedToolIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [fps, setFps] = useState(0);
  const [fileName, setFileName] = useState("");
  const [textEdit, setTextEdit] = useState<{
    screenPos: Vector2;
    zoom: number;
    onCommit: (text: string) => void;
  } | null>(null);

  const [tools] = useState<WheelItem[]>(() => {
    const canvasTools = DrawableCanvas.makeTools();
    const items = canvasTools.map((tool, index) =>
      toolToWheelItem(() => drawableCanvasRef.current, tool, index, setSelectedToolIndex)
    );
    return items;
  });

  const [canvasTools] = useState(() => DrawableCanvas.makeTools());

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
  }, [id]);

  const back = useCallback(async () => {
    await autoSave();
    drawableCanvasRef.current?.collapse();
    navigate("/library");
  }, [autoSave, navigate]);

  useEffect(() => {
    if (!id) return;
    FileSystem.getNodeFileName(id).then((name) => {
      if (name) setFileName(name);
    });
  }, [id]);

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

    const dc = new DrawableCanvas(canvas);
    drawableCanvasRef.current = dc;

    dc.setOnZoomChange((zoom) => {
      setZoomLevel(Math.round(zoom * 100));
    });

    dc.setOnRequestTextEdit((screenPos, _worldPos, zoom, onCommit) => {
      setTextEdit({ screenPos, zoom, onCommit });
    });

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
      .then(() => FileSystem.saveToFile(id, dc))
      .catch(console.error);

    return () => {
      cancelAnimationFrame(animationFrameId);
      unbindKeys();
    };
  }, []);

  return (
    <div className="bg-page w-full h-full overflow-hidden relative">
      {/* Title bar */}
      <div className={`absolute left-6 top-6 ${glassPanel} px-4 py-3 flex items-center gap-3 z-10`}>
        <button onClick={back} className="bg-transparent p-0 border-none cursor-pointer">
          <ChevronLeftIcon className="size-5 text-text-secondary hover:text-text-primary transition-colors" />
        </button>
        <span className="h-4 w-px bg-border-divider" />
        <h2 className="text-sm font-medium text-text-primary m-0">{fileName}</h2>
        <span className="text-[10px] uppercase tracking-wider font-bold text-text-muted">Canvas</span>
      </div>

      {/* Toolbar */}
      <TooltipProvider>
        <div className={`absolute top-6 left-1/2 -translate-x-1/2 ${glassPanel} px-3 py-2 flex items-center gap-1 z-10`}>
          {canvasTools.map((tool, index) => {
            const Icon = tool.icon;
            const isActive = selectedToolIndex === index;
            return (
              <Tooltip key={index}>
                <TooltipTrigger
                    className={`p-2.5 rounded-lg border-none cursor-pointer transition-colors ${
                      isActive
                        ? "bg-accent-dark text-white shadow-md"
                        : "bg-transparent text-text-secondary hover:bg-black/5"
                    }`}
                    onClick={() => {
                      drawableCanvasRef.current?.switchTool(index);
                      setSelectedToolIndex(index);
                    }}
                  >
                    <Icon className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{tool.label}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>

      {/* Canvas */}
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* Info panel */}
      <div className={`absolute right-6 bottom-6 ${glassPanel} px-4 py-3 z-10`}>
        <span className="text-xs font-medium text-text-secondary">{zoomLevel}%</span>
        <span className="mx-2 text-border-divider">|</span>
        <span className="text-xs font-medium text-text-muted">{fps} fps</span>
      </div>

      {/* Text editing overlay */}
      {textEdit && (
        <textarea
          autoFocus
          className="absolute z-20 bg-transparent border-none outline-none resize-none overflow-hidden text-text-primary caret-accent-dark"
          style={{
            left: textEdit.screenPos.x,
            top: textEdit.screenPos.y,
            fontSize: 24 * textEdit.zoom,
            lineHeight: 1.3,
            fontFamily: "sans-serif",
            minWidth: 4,
            minHeight: 24 * textEdit.zoom * 1.3,
          }}
          onBlur={(e) => {
            textEdit.onCommit(e.currentTarget.value);
            setTextEdit(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.blur();
              setTextEdit(null);
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              textEdit.onCommit(e.currentTarget.value);
              setTextEdit(null);
            }
          }}
          onInput={(e) => {
            const ta = e.currentTarget;
            ta.style.height = "auto";
            ta.style.height = ta.scrollHeight + "px";
            ta.style.width = "auto";
            ta.style.width = ta.scrollWidth + 4 + "px";
          }}
        />
      )}

      {/* Wheel picker */}
      <WheelPicker ref={wheelRef} radius={100} items={tools}>
        <XIcon className="size-4 text-white" />
      </WheelPicker>
    </div>
  );
}
