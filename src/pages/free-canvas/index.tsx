import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DrawableCanvas } from "@/pages/free-canvas/drawable-canvas";
import { ITool } from "@/pages/free-canvas/tools/tool";
import { WheelPicker, WheelPickerHandle, WheelItem } from "@/components/wheel-picker";
import { FileSystem } from "@/lib/utils/file-system";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronLeft as ChevronLeftIcon, X as XIcon } from "lucide-react";

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

    FileSystem.loadFromFile(id, dc)
      .then(() => FileSystem.saveToFile(id, dc))
      .catch(console.error);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="bg-black w-full h-full overflow-hidden relative">
      {/* Title bar */}
      <div className="absolute left-4 top-4 bg-white rounded-lg shadow-md p-4 flex flex-row justify-center items-center gap-4 z-10">
        <button onClick={back} className="bg-transparent p-0 border-none cursor-pointer">
          <ChevronLeftIcon width={20} height={20} className="text-primary hover:text-icons transition-colors" />
        </button>
        <h2 className="text-base font-normal m-0">{fileName}</h2>
        <span className="text-xs self-end -ml-2 text-low-contrast">Canvas</span>
      </div>

      {/* Toolbar */}
      <TooltipProvider>
        <div className="absolute top-4 right-1/2 translate-x-1/2 bg-white rounded-lg shadow-md p-4 flex flex-row items-center justify-center gap-4 z-10">
          {canvasTools.map((tool, index) => {
            const Icon = tool.icon;
            return (
              <Tooltip key={index}>
                <TooltipTrigger
                    className="bg-transparent p-0 border-none cursor-pointer"
                    onClick={() => {
                      drawableCanvasRef.current?.switchTool(index);
                      setSelectedToolIndex(index);
                    }}
                  >
                    <Icon
                      width="1.7em"
                      height="1.7em"
                      className={`transition-colors ${
                        selectedToolIndex === index ? "text-icons" : "text-primary hover:text-icons"
                      }`}
                    />
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
      <div className="absolute left-4 bottom-4 bg-white rounded-lg shadow-md p-4 z-10">
        <span className="text-sm">Zoom: {zoomLevel}%</span><br />
        <span className="text-sm">FPS: {fps}</span>
      </div>

      {/* Wheel picker */}
      <WheelPicker ref={wheelRef} radius={100} items={tools}>
        <XIcon width={16} height={16} className="text-icons" />
      </WheelPicker>
    </div>
  );
}
