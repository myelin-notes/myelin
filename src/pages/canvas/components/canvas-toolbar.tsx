import { memo, useRef } from 'react';
import {
  Plus as PlusIcon,
  SlidersHorizontal as SlidersIcon,
} from 'lucide-react';
import type { CustomColorTool } from '@myelin/editor/sync/repo/types';
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
import { useCompactCanvasLayout } from '@/hooks/use-compact-canvas-layout';
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

function getCustomColorTool(tool: ITool | undefined): CustomColorTool | null {
  switch (tool?.id) {
    case 'pen':
    case 'highlighter':
    case 'text':
      return tool.id;
    default:
      return null;
  }
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
  const compact = useCompactCanvasLayout();
  const optionsOpen = optionsVisible && hasOptions && !shelfOpen;
  const optionsPresence = usePresence(optionsOpen);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarInnerRef = useRef<HTMLDivElement>(null);
  const toolButtonRefs = useRef<(HTMLElement | null)[]>([]);
  const shelfButtonRef = useRef<HTMLElement | null>(null);
  const insertButtonRef = useRef<HTMLElement | null>(null);

  // Compact stacks the panels above a bottom bar, where they span its width and
  // need no per-button alignment.
  const getButtonOffset = (btn: HTMLElement | null) => {
    if (compact || !(btn && toolbarInnerRef.current)) {
      return 0;
    }
    return btn.offsetTop - toolbarInnerRef.current.offsetTop;
  };
  const optionsPanelOffset = getButtonOffset(
    toolButtonRefs.current[selectedToolIndex],
  );
  const shelfPanelOffset = getButtonOffset(shelfButtonRef.current);
  const insertPanelOffset = getButtonOffset(insertButtonRef.current);
  const tooltipSide = compact ? 'top' : 'right';
  // Panels hang off the rail's right edge, or off the top of the bottom bar.
  const panelAnchorClass = compact
    ? 'absolute right-0 bottom-full left-0 mb-2'
    : 'absolute top-0 left-full';
  // The options controls are narrow, so stretched across the bar the panel is
  // mostly empty. On compact it sizes to its content and centres over the bar.
  const optionsAnchorClass = compact
    ? 'absolute right-0 bottom-full left-0 mx-auto mb-2 w-fit max-w-[calc(100vw-1.5rem)]'
    : panelAnchorClass;
  const dividerClass = compact
    ? 'mx-1 h-4 w-px bg-border-divider'
    : 'my-1 h-px w-4 bg-border-divider';
  // 44px touch target on compact, against 36px for a cursor.
  const buttonPadClass = compact ? 'p-3.5' : 'p-2.5';

  return (
    <TooltipProvider>
      {/* Compact panels open over the canvas with no room left to click beside
          them, so dismissing means tapping the canvas — which would start a
          stroke. This swallows that tap. Sits below the toolbar's own z-100 so
          the tools stay live while a panel is open. Shelf and insert close
          themselves on an outside pointerdown; the options panel has no such
          handler. */}
      {compact && (optionsOpen || shelfOpen || insertOpen) && (
        <div
          className="fixed inset-0 z-[99]"
          onPointerDown={() => {
            if (optionsOpen) {
              onToggleOptions();
            }
          }}
        />
      )}
      <div
        ref={toolbarRef}
        className={
          compact
            ? 'fade-in-0 slide-in-from-bottom-3 absolute inset-x-0 bottom-0 z-[100] flex animate-in justify-center px-3 pb-3 duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]'
            : 'fade-in-0 slide-in-from-left-3 absolute top-1/2 left-6 z-[100] max-h-[calc(100dvh-6rem)] -translate-y-1/2 animate-in duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]'
        }
        role="toolbar"
        aria-label="Canvas tools"
      >
        <div
          ref={toolbarInnerRef}
          className={
            compact
              ? 'flex max-w-full flex-row items-center gap-1 overflow-x-auto rounded-xl bg-card px-2 py-2 ring-1 ring-border-subtle/70 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
              : 'flex max-h-[calc(100dvh-6rem)] flex-col items-center gap-1 overflow-y-auto rounded-xl bg-card px-2 py-3 ring-1 ring-border-subtle/70 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          }
        >
          <Tooltip>
            <TooltipTrigger
              ref={(el) => {
                insertButtonRef.current = el;
              }}
              data-insert-trigger
              aria-label={strings.canvas.toolbar.insert}
              className={`shrink-0 cursor-pointer rounded-lg ${buttonPadClass} transition-colors ${
                insertOpen
                  ? 'bg-accent-dark text-text-on-dark'
                  : 'bg-transparent text-text-secondary hover:bg-hover-tint'
              }`}
              onClick={onToggleInsert}
            >
              <PlusIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>
              <p>{strings.canvas.toolbar.insert}</p>
            </TooltipContent>
          </Tooltip>

          <div className={`shrink-0 ${dividerClass}`} />

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
                  className={`group relative shrink-0 cursor-pointer rounded-lg ${buttonPadClass} transition-colors ${
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
                <TooltipContent side={tooltipSide}>
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

          <div className={`shrink-0 ${dividerClass}`} />

          <Tooltip>
            <TooltipTrigger
              ref={(el) => {
                shelfButtonRef.current = el;
              }}
              aria-label={strings.canvas.toolbar.customizeWheel}
              className={`shrink-0 cursor-pointer rounded-lg ${buttonPadClass} transition-colors ${
                shelfOpen
                  ? 'bg-accent-dark text-text-on-dark'
                  : 'bg-transparent text-text-secondary hover:bg-hover-tint'
              }`}
              onClick={onToggleShelf}
            >
              <SlidersIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>
              <p>{strings.canvas.toolbar.customizeWheel}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {optionsPresence.mounted && (
          <div
            {...optionsPresence.state}
            onAnimationEnd={optionsPresence.onAnimationEnd}
            className={`data-closed:fade-out-0 data-open:fade-in-0 duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] data-closed:animate-out data-open:animate-in ${
              compact
                ? 'data-closed:slide-out-to-bottom-2 data-open:slide-in-from-bottom-2'
                : 'data-closed:slide-out-to-left-2 data-open:slide-in-from-left-2 ml-2'
            } ${optionsAnchorClass}`}
            style={compact ? undefined : { top: optionsPanelOffset }}
          >
            <ToolOptionsPanel
              options={activeOptions}
              customColorTool={getCustomColorTool(tools[selectedToolIndex])}
            />
          </div>
        )}

        {shelfOpen && (
          <div
            className={compact ? panelAnchorClass : `${panelAnchorClass} ml-2`}
            style={compact ? undefined : { paddingTop: shelfPanelOffset }}
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
            className={panelAnchorClass}
            style={compact ? undefined : { paddingTop: insertPanelOffset }}
          >
            {embedComposer}
          </div>
        )}

        {insertOpen && !shelfOpen && (
          <div
            className={panelAnchorClass}
            style={compact ? undefined : { paddingTop: insertPanelOffset }}
          >
            {insertPopover}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
});
