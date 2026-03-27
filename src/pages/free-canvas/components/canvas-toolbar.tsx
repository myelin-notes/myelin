import { useRef } from "react";
import { ITool, ToolOption } from "@/pages/free-canvas/tools/tool";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SlidersHorizontal as SlidersIcon } from "lucide-react";
import { ToolShelf } from "@/components/tool-shelf";
import { ToolOptionsPanel } from "@/components/tool-options-panel";

interface CanvasToolbarProps {
  tools: ITool[];
  selectedToolIndex: number;
  optionsVisible: boolean;
  shelfOpen: boolean;
  activeOptions: ToolOption[];
  hasOptions: boolean;
  wheelEnabledIndices: Set<number>;
  onSelectTool: (index: number) => void;
  onToggleOptions: () => void;
  onSetOption: (key: string, value: unknown) => void;
  onToggleShelf: () => void;
  onCloseShelf: () => void;
  onToggleWheelTool: (index: number) => void;
}

export function CanvasToolbar({
  tools,
  selectedToolIndex,
  optionsVisible,
  shelfOpen,
  activeOptions,
  hasOptions,
  wheelEnabledIndices,
  onSelectTool,
  onToggleOptions,
  onSetOption,
  onToggleShelf,
  onCloseShelf,
  onToggleWheelTool,
}: CanvasToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarInnerRef = useRef<HTMLDivElement>(null);
  const toolButtonRefs = useRef<(HTMLElement | null)[]>([]);
  const shelfButtonRef = useRef<HTMLElement | null>(null);

  const getButtonOffset = (btn: HTMLElement | null) => {
    if (!btn || !toolbarInnerRef.current) return 0;
    return btn.offsetTop - toolbarInnerRef.current.offsetTop;
  };
  const optionsPanelOffset = getButtonOffset(toolButtonRefs.current[selectedToolIndex]);
  const shelfPanelOffset = getButtonOffset(shelfButtonRef.current);

  return (
    <TooltipProvider>
      <div ref={toolbarRef} className="absolute left-6 top-1/2 -translate-y-1/2 z-10">
        <div ref={toolbarInnerRef} className="backdrop-blur-[24px] bg-white/80 rounded-xl shadow-ambient px-2 py-3 flex flex-col items-center gap-1">
          {tools.map((tool, index) => {
            const Icon = tool.icon;
            const isActive = selectedToolIndex === index;
            const toolHasOptions = (tool.getOptions?.()?.length ?? 0) > 0;
            return (
              <Tooltip key={index}>
                <TooltipTrigger
                    ref={(el) => { toolButtonRefs.current[index] = el; }}
                    className={`relative p-2.5 rounded-xl cursor-pointer transition-colors ${
                      isActive
                        ? "bg-accent-dark text-white"
                        : "bg-transparent text-text-secondary hover:bg-hover-tint"
                    }`}
                    onClick={() => {
                      if (isActive && toolHasOptions) {
                        onToggleOptions();
                      } else {
                        onSelectTool(index);
                      }
                    }}
                  >
                    <Icon className="size-4" />
                    {isActive && toolHasOptions && !optionsVisible && (
                      <span className="absolute -right-0.5 top-1/2 -translate-y-1/2 size-1 rounded-full bg-white/70" />
                    )}
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{tool.label}{isActive && toolHasOptions ? " — click for options" : ""}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}

          <div className="h-px w-4 bg-border-divider my-1" />

          <Tooltip>
            <TooltipTrigger
              ref={(el) => { shelfButtonRef.current = el; }}
              className={`p-2.5 rounded-xl cursor-pointer transition-colors ${
                shelfOpen
                  ? "bg-accent-dark text-white"
                  : "bg-transparent text-text-secondary hover:bg-hover-tint"
              }`}
              onClick={onToggleShelf}
            >
              <SlidersIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Customize wheel</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {optionsVisible && hasOptions && !shelfOpen && (
          <div className="absolute left-full top-0 ml-2" style={{ paddingTop: optionsPanelOffset }}>
            <ToolOptionsPanel options={activeOptions} onSetOption={onSetOption} />
          </div>
        )}

        {shelfOpen && (
          <div className="absolute left-full top-0 ml-2" style={{ paddingTop: shelfPanelOffset }}>
            <ToolShelf
              tools={tools}
              enabledIndices={wheelEnabledIndices}
              onToggle={onToggleWheelTool}
              onClose={onCloseShelf}
              containerRef={toolbarRef}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
