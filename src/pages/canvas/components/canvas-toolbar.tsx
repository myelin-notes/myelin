import { memo, useRef } from 'react';
import {
  Plus as PlusIcon,
  SlidersHorizontal as SlidersIcon,
} from 'lucide-react';
import type { ITool, ToolOption } from '@myelin/editor/tools/tool';
import { getToolHotkey } from '@myelin/editor/tools/tool-keybinds';
import { usePresence } from '@myelin/ui';
import { ToolOptionsPanel } from '@/components/tool-options-panel';
import { ToolShelf } from '@/components/tool-shelf';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useMessages } from '@/lib/i18n';

interface CanvasToolbarProps {
  tools: ITool[];
  selectedToolIndex: number;
  optionsVisible: boolean;
  shelfOpen: boolean;
  insertOpen: boolean;
  activeOptions: ToolOption[];
  hasOptions: boolean;
  wheelEnabledIndices: Set<number>;
  onSelectTool: (index: number) => void;
  onToggleOptions: () => void;
  onToggleShelf: () => void;
  onCloseShelf: () => void;
  onToggleInsert: () => void;
  onToggleWheelTool: (index: number) => void;
  insertPopover?: React.ReactNode;
  embedComposer?: React.ReactNode;
}

export const CanvasToolbar = memo(function CanvasToolbar({
  tools,
  selectedToolIndex,
  optionsVisible,
  shelfOpen,
  insertOpen,
  activeOptions,
  hasOptions,
  wheelEnabledIndices,
  onSelectTool,
  onToggleOptions,
  onToggleShelf,
  onCloseShelf,
  onToggleInsert,
  onToggleWheelTool,
  insertPopover,
  embedComposer,
}: CanvasToolbarProps) {
  const strings = useMessages();
  const optionsPresence = usePresence(
    optionsVisible && hasOptions && !shelfOpen,
  );
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarInnerRef = useRef<HTMLDivElement>(null);
  const toolButtonRefs = useRef<(HTMLElement | null)[]>([]);
  const shelfButtonRef = useRef<HTMLElement | null>(null);
  const insertButtonRef = useRef<HTMLElement | null>(null);

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
  const insertPanelOffset = getButtonOffset(insertButtonRef.current);

  return (
    <TooltipProvider>
      <div
        ref={toolbarRef}
        className="fade-in-0 slide-in-from-left-3 absolute top-1/2 left-6 z-[100] max-h-[calc(100dvh-6rem)] -translate-y-1/2 animate-in duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]"
        role="toolbar"
        aria-label="Canvas tools"
      >
        <div
          ref={toolbarInnerRef}
          data-tour="canvas-toolbar"
          className="flex max-h-[calc(100dvh-6rem)] flex-col items-center gap-1 overflow-y-auto rounded-xl bg-card px-2 py-3 ring-1 ring-border-subtle/70 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <Tooltip>
            <TooltipTrigger
              ref={(el) => {
                insertButtonRef.current = el;
              }}
              data-insert-trigger
              data-tour="canvas-insert"
              aria-label={strings.canvas.toolbar.insert}
              className={`cursor-pointer rounded-lg p-2.5 transition-colors ${
                insertOpen
                  ? 'bg-accent-dark text-text-on-dark'
                  : 'bg-transparent text-text-secondary hover:bg-hover-tint'
              }`}
              onClick={onToggleInsert}
            >
              <PlusIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{strings.canvas.toolbar.insert}</p>
            </TooltipContent>
          </Tooltip>

          <div className="my-1 h-px w-4 bg-border-divider" />

          {tools.map((tool, index) => {
            const Icon = tool.icon;
            const isActive = selectedToolIndex === index;
            const toolHasOptions = (tool.getOptions?.()?.length ?? 0) > 0;
            const hotkey = getToolHotkey(tool.id);
            return (
              <Tooltip key={index}>
                <TooltipTrigger
                  ref={(el) => {
                    toolButtonRefs.current[index] = el;
                  }}
                  aria-label={tool.label}
                  className={`group relative cursor-pointer rounded-lg p-2.5 transition-colors ${
                    isActive
                      ? 'bg-accent-dark text-text-on-dark'
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
                          ? 'bg-text-on-dark/60'
                          : 'bg-current opacity-0 group-hover:opacity-20'
                      }`}
                    />
                  )}
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="flex items-center gap-2">
                    <span>
                      {tool.label}
                      {isActive && toolHasOptions
                        ? ` - ${strings.canvas.toolbar.clickForOptions}`
                        : ''}
                    </span>
                    {hotkey && (
                      <kbd className="flex min-w-[18px] items-center justify-center rounded-[4px] border border-white/20 bg-white/10 px-1 py-[1px] font-sans font-semibold text-[10px] text-white/80">
                        {hotkey}
                      </kbd>
                    )}
                  </div>
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
              aria-label={strings.canvas.toolbar.customizeWheel}
              className={`cursor-pointer rounded-lg p-2.5 transition-colors ${
                shelfOpen
                  ? 'bg-accent-dark text-text-on-dark'
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

        {optionsPresence.mounted && (
          <div
            {...optionsPresence.state}
            onAnimationEnd={optionsPresence.onAnimationEnd}
            className="data-closed:slide-out-to-left-2 data-closed:fade-out-0 data-open:slide-in-from-left-2 data-open:fade-in-0 absolute left-full ml-2 duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] data-closed:animate-out data-open:animate-in"
            style={{ top: optionsPanelOffset }}
          >
            <ToolOptionsPanel options={activeOptions} />
          </div>
        )}

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
            style={{ paddingTop: insertPanelOffset }}
          >
            {embedComposer}
          </div>
        )}

        {insertOpen && !shelfOpen && (
          <div
            className="absolute top-0 left-full"
            style={{ paddingTop: insertPanelOffset }}
          >
            {insertPopover}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
});
