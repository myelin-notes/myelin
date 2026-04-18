import { useRef } from 'react';
import { SlidersHorizontal as SlidersIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ToolOptionsPanel } from '@/components/tool-options-panel';
import { ToolShelf } from '@/components/tool-shelf';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useStrings } from '@/lib/i18n';
import type { ITool, ToolOption } from '@/pages/canvas/tools/tool';

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
  embedComposer?: React.ReactNode;
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
  embedComposer,
}: CanvasToolbarProps) {
  const strings = useStrings();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarInnerRef = useRef<HTMLDivElement>(null);
  const toolButtonRefs = useRef<(HTMLElement | null)[]>([]);
  const shelfButtonRef = useRef<HTMLElement | null>(null);

  const getButtonOffset = (btn: HTMLElement | null) => {
    if (!(btn && toolbarInnerRef.current)) {
      return 0;
    }
    return btn.offsetTop - toolbarInnerRef.current.offsetTop;
  };
  const optionsPanelOffset = getButtonOffset(
    toolButtonRefs.current[selectedToolIndex],
  );
  const shelfPanelOffset = getButtonOffset(shelfButtonRef.current);

  return (
    <TooltipProvider>
      <motion.div
        ref={toolbarRef}
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        className="absolute top-1/2 left-6 z-10 -translate-y-1/2"
      >
        <div
          ref={toolbarInnerRef}
          className="flex flex-col items-center gap-1 rounded-xl bg-white/80 px-2 py-3 shadow-ambient backdrop-blur-[24px]"
        >
          {tools.map((tool, index) => {
            const Icon = tool.icon;
            const isActive = selectedToolIndex === index;
            const toolHasOptions = (tool.getOptions?.()?.length ?? 0) > 0;
            return (
              <Tooltip key={index}>
                <TooltipTrigger
                  ref={(el) => {
                    toolButtonRefs.current[index] = el;
                  }}
                  className={`group relative cursor-pointer rounded-xl p-2.5 transition-colors ${
                    isActive
                      ? 'bg-accent-dark text-white'
                      : 'bg-transparent text-text-secondary hover:bg-hover-tint'
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
                  {toolHasOptions && (
                    <span
                      className={`absolute bottom-1 left-1/2 h-[2px] w-3 -translate-x-1/2 rounded-full transition-opacity ${
                        isActive
                          ? 'bg-white/60'
                          : 'bg-current opacity-0 group-hover:opacity-20'
                      }`}
                    />
                  )}
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>
                    {tool.label}
                    {isActive && toolHasOptions
                      ? ` - ${strings.canvas.toolbar.clickForOptions}`
                      : ''}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          })}

          <div className="my-1 h-px w-4 bg-border-divider" />

          <Tooltip>
            <TooltipTrigger
              ref={(el) => {
                shelfButtonRef.current = el;
              }}
              className={`cursor-pointer rounded-xl p-2.5 transition-colors ${
                shelfOpen
                  ? 'bg-accent-dark text-white'
                  : 'bg-transparent text-text-secondary hover:bg-hover-tint'
              }`}
              onClick={onToggleShelf}
            >
              <SlidersIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{strings.canvas.toolbar.customizeWheel}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <AnimatePresence>
          {optionsVisible && hasOptions && !shelfOpen && (
            <motion.div
              key={selectedToolIndex}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="absolute top-0 left-full ml-2"
              style={{ paddingTop: optionsPanelOffset }}
            >
              <ToolOptionsPanel
                options={activeOptions}
                onSetOption={onSetOption}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {shelfOpen && (
          <div
            className="absolute top-0 left-full ml-2"
            style={{ paddingTop: shelfPanelOffset }}
          >
            <ToolShelf
              tools={tools}
              enabledIndices={wheelEnabledIndices}
              onToggle={onToggleWheelTool}
              onClose={onCloseShelf}
              containerRef={toolbarRef}
            />
          </div>
        )}

        {!shelfOpen && embedComposer && (
          <div
            className="absolute top-0 left-full"
            style={{ paddingTop: optionsPanelOffset }}
          >
            {embedComposer}
          </div>
        )}
      </motion.div>
    </TooltipProvider>
  );
}
