import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DrawableCanvas } from "@/pages/free-canvas/drawable-canvas";
import { ITool, ToolOption } from "@/pages/free-canvas/tools/tool";
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
import { ChevronLeft as ChevronLeftIcon, X as XIcon, SlidersHorizontal as SlidersIcon } from "lucide-react";
import { Vector2 } from "@/pages/free-canvas/drawable-canvas";
import { ToolShelf, loadWheelToolIndices, saveWheelToolIndices } from "@/components/tool-shelf";
import { ToolOptionsPanel, loadGoogleFont } from "@/components/tool-options-panel";
import { UserPrefs } from "@/lib/user-prefs";

function makeSizeChildren(
  tool: ITool,
  sizeOpt: Extract<ToolOption, { type: 'size' }>,
  applyRef: { current: (tool: ITool, key: string, value: unknown) => void },
): WheelItem[] {
  const { min, max, key } = sizeOpt;
  const mid = Math.round((min + max) / 2);
  return [
    { label: `Fine (${min})`,   dot: 4,  command: () => applyRef.current(tool, key, min) },
    { label: `Medium (${mid})`, dot: 8,  command: () => applyRef.current(tool, key, mid) },
    { label: `Bold (${max})`,   dot: 14, command: () => applyRef.current(tool, key, max) },
  ];
}

function toolToWheelItem(
  getCanvas: () => DrawableCanvas | null,
  tool: ITool,
  toolIndex: number,
  setSelectedToolIndex: (i: number) => void,
  applyRef: { current: (tool: ITool, key: string, value: unknown) => void },
): WheelItem {
  const options = tool.getOptions?.() ?? [];
  const colorOpt = options.find((o): o is Extract<ToolOption, { type: 'color' }> => o.type === 'color');
  const sizeOpt = options.find((o): o is Extract<ToolOption, { type: 'size' }> => o.type === 'size');

  let children: WheelItem[] | undefined;

  if (colorOpt) {
    children = colorOpt.palette.map(hex => ({
      label: hex,
      color: hex,
      command: () => applyRef.current(tool, colorOpt.key, hex),
      children: sizeOpt ? makeSizeChildren(tool, sizeOpt, applyRef) : undefined,
    }));
  } else if (sizeOpt) {
    children = makeSizeChildren(tool, sizeOpt, applyRef);
  }

  return {
    label: tool.label,
    icon: tool.icon,
    command: () => {
      getCanvas()?.switchTool(toolIndex);
      setSelectedToolIndex(toolIndex);
    },
    children,
  };
}

const glassPanel = "backdrop-blur-[24px] bg-white/80 rounded-xl shadow-ambient";

export function CanvasView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wheelRef = useRef<WheelPickerHandle>(null);
  const drawableCanvasRef = useRef<DrawableCanvas | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingEmbedPos = useRef<Vector2 | null>(null);

  const [selectedToolIndex, setSelectedToolIndex] = useState(0);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [fps, setFps] = useState(0);
  const [fileName, setFileName] = useState("");
  const [optionsTick, setOptionsTick] = useState(0);
  const [textEdit, setTextEdit] = useState<{
    screenPos: Vector2;
    screenFontSize: number;
    fontFamily: string;
    initialText: string;
    onCommit: (text: string) => void;
  } | null>(null);

  const [canvasTools] = useState(() => {
    const tools = DrawableCanvas.makeTools();
    const saved = UserPrefs.get("toolOptions");
    for (const tool of tools) {
      const opts = saved[tool.label];
      if (opts && tool.setOption) {
        for (const [key, value] of Object.entries(opts)) {
          tool.setOption(key, value);
          if (key === "fontFamily" && typeof value === "string") {
            loadGoogleFont(value);
          }
        }
      }
    }
    return tools;
  });

  // Ref for wheel sub-item commands — avoids stale closures since wheel items are created once
  const applyOptionRef = useRef<(tool: ITool, key: string, value: unknown) => void>(() => {});
  applyOptionRef.current = (tool: ITool, key: string, value: unknown) => {
    tool.setOption?.(key, value);
    setOptionsTick(t => t + 1);
    UserPrefs.update("toolOptions", (all) => ({
      ...all, [tool.label]: { ...all[tool.label], [key]: value },
    }));
  };

  const [allWheelItems] = useState<WheelItem[]>(() =>
    canvasTools.map((tool, index) =>
      toolToWheelItem(
        () => drawableCanvasRef.current,
        tool, index, setSelectedToolIndex,
        applyOptionRef,
      )
    )
  );

  const [wheelEnabledIndices, setWheelEnabledIndices] = useState<Set<number>>(
    () => loadWheelToolIndices(canvasTools.length)
  );
  const [shelfOpen, setShelfOpen] = useState(false);

  const wheelItems = useMemo(
    () => allWheelItems.filter((_, i) => wheelEnabledIndices.has(i)),
    [allWheelItems, wheelEnabledIndices],
  );

  // Hide options when switching tools
  useEffect(() => {
    setOptionsVisible(false);
  }, [selectedToolIndex]);

  const activeOptions = useMemo(() => {
    void optionsTick;
    const tool = canvasTools[selectedToolIndex];
    return tool?.getOptions?.() ?? [];
  }, [selectedToolIndex, optionsTick, canvasTools]);

  const hasOptions = activeOptions.length > 0;

  const handleSetOption = useCallback((key: string, value: unknown) => {
    const tool = canvasTools[selectedToolIndex];
    if (tool?.setOption) {
      tool.setOption(key, value);
      setOptionsTick(t => t + 1);
      UserPrefs.update("toolOptions", (all) => {
        const opts = { ...all[tool.label], [key]: value };
        return { ...all, [tool.label]: opts };
      });
    }
  }, [selectedToolIndex, canvasTools]);

  const handleToggleWheelTool = useCallback((index: number) => {
    setWheelEnabledIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      saveWheelToolIndices(next);
      return next;
    });
  }, []);

  const embedFiles = useCallback((files: FileList | File[], screenX?: number, screenY?: number) => {
    const dc = drawableCanvasRef.current;
    if (!dc) return;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        dc.addImageFromBlob(file, screenX, screenY);
      }
    }
  }, []);

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

    // Drag-and-drop media onto canvas
    canvas.addEventListener("dragover", (evt) => {
      evt.preventDefault();
    });

    canvas.addEventListener("drop", (evt) => {
      evt.preventDefault();
      if (evt.dataTransfer?.files?.length) {
        embedFiles(Array.from(evt.dataTransfer.files), evt.pageX, evt.pageY);
      }
    });

    // Paste media from clipboard
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

    dc.setOnZoomChange((zoom) => {
      setZoomLevel(Math.round(zoom * 100));
    });

    dc.setOnRequestTextEdit((screenPos, screenFontSize, fontFamily, initialText, onCommit) => {
      setTextEdit({ screenPos, screenFontSize, fontFamily, initialText, onCommit });
    });

    dc.setOnRequestFilePick((screenPos) => {
      pendingEmbedPos.current = screenPos;
      fileInputRef.current?.click();
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
      document.removeEventListener("paste", handlePaste);
    };
  }, []);

  return (
    <div className="bg-page w-full h-full overflow-hidden relative">
      {/* Title bar */}
      <div className={`absolute left-6 top-6 ${glassPanel} px-4 py-3 flex items-center gap-3 z-10`}>
        <button onClick={back} className="bg-transparent p-0 border-none cursor-pointer">
          <ChevronLeftIcon className="size-5 text-text-secondary hover:text-text-primary transition-colors" />
        </button>
        <h2 className="text-sm font-medium text-text-primary m-0 ml-1">{fileName}</h2>
        <span className="text-[10px] uppercase tracking-[0.05em] font-bold text-text-muted">Canvas</span>
      </div>

      {/* Toolbar */}
      <TooltipProvider>
        <div ref={toolbarRef} className="absolute top-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2">
          <div className={`${glassPanel} px-3 py-2 flex items-center gap-1`}>
            {canvasTools.map((tool, index) => {
              const Icon = tool.icon;
              const isActive = selectedToolIndex === index;
              const toolHasOptions = (tool.getOptions?.()?.length ?? 0) > 0;
              return (
                <Tooltip key={index}>
                  <TooltipTrigger
                      className={`relative p-2.5 rounded-xl cursor-pointer transition-colors ${
                        isActive
                          ? "bg-accent-dark text-white"
                          : "bg-transparent text-text-secondary hover:bg-hover-tint"
                      }`}
                      onClick={() => {
                        if (isActive && toolHasOptions) {
                          setOptionsVisible(v => !v);
                          setShelfOpen(false);
                        } else {
                          drawableCanvasRef.current?.switchTool(index);
                          setSelectedToolIndex(index);
                          setShelfOpen(false);
                        }
                      }}
                    >
                      <Icon className="size-4" />
                      {isActive && toolHasOptions && !optionsVisible && (
                        <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full bg-white/70" />
                      )}
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{tool.label}{isActive && toolHasOptions ? " — click for options" : ""}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}

            <div className="w-px h-4 bg-border-divider mx-1" />

            <Tooltip>
              <TooltipTrigger
                className={`p-2.5 rounded-xl cursor-pointer transition-colors ${
                  shelfOpen
                    ? "bg-accent-dark text-white"
                    : "bg-transparent text-text-secondary hover:bg-hover-tint"
                }`}
                onClick={() => {
                  setShelfOpen(v => !v);
                  setOptionsVisible(false);
                }}
              >
                <SlidersIcon className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Customize wheel</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Tool options panel — toggled by clicking the active tool */}
          {optionsVisible && hasOptions && !shelfOpen && (
            <ToolOptionsPanel options={activeOptions} onSetOption={handleSetOption} />
          )}

          {shelfOpen && (
            <ToolShelf
              tools={canvasTools}
              enabledIndices={wheelEnabledIndices}
              onToggle={handleToggleWheelTool}
              onClose={() => setShelfOpen(false)}
              containerRef={toolbarRef}
            />
          )}
        </div>
      </TooltipProvider>

      {/* Canvas */}
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* Hidden file input for embed tool */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (files?.length) {
            embedFiles(Array.from(files), pendingEmbedPos.current?.x, pendingEmbedPos.current?.y);
          }
          e.currentTarget.value = "";
          pendingEmbedPos.current = null;
        }}
      />

      {/* Info panel */}
      <div className={`absolute right-6 bottom-6 ${glassPanel} px-4 py-3 z-10`}>
        <span className="text-xs font-medium text-text-secondary">{zoomLevel}%</span>
        <span className="mx-2 text-text-muted/30">|</span>
        <span className="text-xs font-medium text-text-muted">{fps} fps</span>
      </div>

      {/* Text editing overlay */}
      {textEdit && (
        <textarea
          autoFocus
          defaultValue={textEdit.initialText}
          className="absolute z-20 bg-transparent border-none outline-none resize-none overflow-hidden caret-accent-dark p-0 m-0"
          style={{
            left: textEdit.screenPos.x,
            top: textEdit.screenPos.y,
            fontSize: textEdit.screenFontSize,
            lineHeight: 1.3,
            fontFamily: `"${textEdit.fontFamily}", sans-serif`,
            color: "var(--text-primary)",
            minWidth: 4,
            minHeight: textEdit.screenFontSize * 1.3,
          }}
          ref={(el) => {
            if (!el) return;
            const fs = textEdit.screenFontSize;
            const font = `${fs}px "${textEdit.fontFamily}", sans-serif`;
            const mc = document.createElement("canvas").getContext("2d")!;
            mc.font = font;

            const lines = el.value.split("\n");
            let maxW = 0;
            for (const line of lines) {
              maxW = Math.max(maxW, mc.measureText(line).width);
            }
            el.style.width = Math.ceil(maxW + fs) + "px";
            el.style.height = "auto";
            el.style.height = el.scrollHeight + "px";

            mc.textBaseline = "alphabetic";
            const m = mc.measureText("Mg");
            const contentArea = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
            const halfLeading = (fs * 1.3 - contentArea) / 2;
            el.style.top = `${textEdit.screenPos.y - halfLeading}px`;
          }}
          onInput={(e) => {
            const ta = e.currentTarget;
            const fs = textEdit.screenFontSize;
            const font = `${fs}px "${textEdit.fontFamily}", sans-serif`;
            const mc = document.createElement("canvas").getContext("2d")!;
            mc.font = font;
            const lines = ta.value.split("\n");
            let maxW = 0;
            for (const line of lines) {
              maxW = Math.max(maxW, mc.measureText(line).width);
            }
            ta.style.width = Math.ceil(maxW + fs) + "px";
            ta.style.height = "auto";
            ta.style.height = ta.scrollHeight + "px";
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
        />
      )}

      {/* Wheel picker */}
      <WheelPicker ref={wheelRef} radius={100} items={wheelItems}>
        <XIcon className="size-4 text-white" />
      </WheelPicker>
    </div>
  );
}
