import { memo, useLayoutEffect, useRef } from 'react';
import {
  Plus as PlusIcon,
  Ruler as RulerIcon,
  SlidersHorizontal as SlidersIcon,
} from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import type {
  CustomColorTool,
  PenPreset,
} from '@myelin/editor/sync/repo/types';
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
import { useUserPref } from '@/lib/use-user-pref';
import { IS_PHONE_BUILD } from '@/lib/viewport-scale';

interface CanvasToolbarProps {
  tools: ITool[];
  selectedToolIndex: number;
  optionsVisible: boolean;
  shelfOpen: boolean;
  insertOpen: boolean;
  activeOptions: ToolOption[];
  hasOptions: boolean;
  wheelEnabledIndices: Set<number>;
  presets: PenPreset[];
  wheelPresetIds: Set<string>;
  editingPresetId: string | null;
  wheelFull: boolean;
  savePresetDisabledReason: string | null;
  onSavePreset: () => void;
  onTogglePresetInWheel: (preset: PenPreset) => void;
  onSelectTool: (index: number) => void;
  onToggleOptions: () => void;
  onToggleShelf: () => void;
  onCloseShelf: () => void;
  onToggleInsert: () => void;
  rulerVisible: boolean;
  onToggleRuler: () => void;
  onToggleWheelTool: (index: number) => void;
  insertPopover?: React.ReactNode;
  embedComposer?: React.ReactNode;
}

const PANEL_VIEWPORT_MARGIN = 16;

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
  presets,
  wheelPresetIds,
  editingPresetId,
  wheelFull,
  savePresetDisabledReason,
  onSavePreset,
  onTogglePresetInWheel,
  onSelectTool,
  onToggleOptions,
  onToggleShelf,
  onCloseShelf,
  onToggleInsert,
  rulerVisible,
  onToggleRuler,
  onToggleWheelTool,
  insertPopover,
  embedComposer,
}: CanvasToolbarProps) {
  const strings = useMessages();
  const optionsOpen = optionsVisible && hasOptions && !shelfOpen;
  const optionsPresence = usePresence(optionsOpen);
  const onRight = useUserPref('toolbarSide') === 'right' && !IS_PHONE_BUILD;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarInnerRef = useRef<HTMLDivElement>(null);
  const toolButtonRefs = useRef<(HTMLElement | null)[]>([]);
  const insertButtonRef = useRef<HTMLElement | null>(null);
  const optionsPanelRef = useRef<HTMLDivElement>(null);
  const optionsPanelContentRef = useRef<HTMLDivElement>(null);
  // Compact stacks the panels above a bottom bar, where they span its width and
  // need no per-button alignment.
  const getButtonOffset = (btn: HTMLElement | null) => {
    if (IS_PHONE_BUILD || !(btn && toolbarInnerRef.current)) {
      return 0;
    }
    return btn.offsetTop - toolbarInnerRef.current.offsetTop;
  };
  const optionsPanelOffset = getButtonOffset(
    toolButtonRefs.current[selectedToolIndex],
  );
  const insertPanelOffset = getButtonOffset(insertButtonRef.current);
  const tooltipSide = IS_PHONE_BUILD ? 'top' : onRight ? 'left' : 'right';
  // Panels hang off the rail's inner edge, or off the top of the bottom bar.
  // Insert and embed bring their own ml-2, so only the right rail adds a gap.
  const panelAnchorClass = IS_PHONE_BUILD
    ? 'absolute right-0 bottom-full left-0 mb-2'
    : onRight
      ? 'absolute top-0 right-full pr-2'
      : 'absolute top-0 left-full';
  // The options controls are narrow, so stretched across the bar the panel is
  // mostly empty. On compact it sizes to its content and centres over the bar.
  const optionsAnchorClass = IS_PHONE_BUILD
    ? 'absolute right-0 bottom-full left-0 mx-auto mb-2 w-[calc(100vw-1.5rem)] max-w-72'
    : `absolute top-0 w-60 max-w-[calc(100vw-5rem)] ${onRight ? 'right-full' : 'left-full'}`;
  const dividerClass = IS_PHONE_BUILD
    ? 'mx-1 h-4 w-px bg-border-divider'
    : 'my-1 h-px w-4 bg-border-divider';
  // 44px touch target on compact, against 36px for a cursor.
  const buttonPadClass = IS_PHONE_BUILD ? 'p-3.5' : 'p-2.5';

  useLayoutEffect(() => {
    if (IS_PHONE_BUILD || !optionsPresence.mounted) {
      return;
    }

    const panel = optionsPanelRef.current;
    const panelContent = optionsPanelContentRef.current;
    const toolbar = toolbarRef.current;
    const button = toolButtonRefs.current[selectedToolIndex];
    if (!(panel && panelContent && toolbar && button)) {
      return;
    }

    const syncPosition = () => {
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const viewportHeight =
        window.visualViewport?.height ?? window.innerHeight;
      const viewportBottom = viewportTop + viewportHeight;
      panelContent.style.setProperty(
        '--tool-options-available-height',
        `${Math.max(0, viewportHeight - PANEL_VIEWPORT_MARGIN * 2)}px`,
      );
      const panelHeight = panel.getBoundingClientRect().height;
      const toolbarTop = toolbar.getBoundingClientRect().top;
      const anchorTop = button.getBoundingClientRect().top;
      const maxTop = viewportBottom - PANEL_VIEWPORT_MARGIN - panelHeight;
      const top = Math.max(
        viewportTop + PANEL_VIEWPORT_MARGIN,
        Math.min(anchorTop, maxTop),
      );

      panel.style.top = `${Math.round(top - toolbarTop)}px`;
    };

    syncPosition();
    const resizeObserver = new ResizeObserver(syncPosition);
    resizeObserver.observe(panelContent);
    resizeObserver.observe(toolbar);
    window.addEventListener('resize', syncPosition);
    window.visualViewport?.addEventListener('resize', syncPosition);
    window.visualViewport?.addEventListener('scroll', syncPosition);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncPosition);
      window.visualViewport?.removeEventListener('resize', syncPosition);
      window.visualViewport?.removeEventListener('scroll', syncPosition);
    };
  }, [optionsPresence.mounted, selectedToolIndex]);

  return (
    <TooltipProvider>
      {/* Compact panels open over the canvas with no room left to click beside
          them, so dismissing means tapping the canvas — which would start a
          stroke. This swallows that tap. Sits below the toolbar's own z-100 so
          the tools stay live while a panel is open. Shelf and insert close
          themselves on an outside pointerdown; the options panel has no such
          handler. Needs touch-none: without it a drag starting on the scrim
          is handed to WebKit, which scrolls the whole webview. */}
      {IS_PHONE_BUILD && (optionsOpen || shelfOpen || insertOpen) && (
        <div
          className="fixed inset-0 z-[99] touch-none"
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
          IS_PHONE_BUILD
            ? 'fade-in-0 slide-in-from-bottom-3 absolute inset-x-0 bottom-0 z-[100] flex animate-in justify-center px-3 pb-3 duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]'
            : onRight
              ? 'fade-in-0 slide-in-from-right-3 absolute top-1/2 right-6 z-[100] max-h-[calc(100dvh-10rem)] -translate-y-1/2 animate-in duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]'
              : 'fade-in-0 slide-in-from-left-3 absolute top-1/2 left-6 z-[100] max-h-[calc(100dvh-6rem)] -translate-y-1/2 animate-in duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]'
        }
        role="toolbar"
        aria-label="Canvas tools"
      >
        <div
          ref={toolbarInnerRef}
          className={
            IS_PHONE_BUILD
              ? 'flex max-w-full flex-row items-center gap-1 overflow-x-auto rounded-xl bg-card px-2 py-2 ring-1 ring-border-subtle/70 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
              : `flex flex-col items-center gap-1 overflow-y-auto rounded-xl bg-card px-2 py-3 ring-1 ring-border-subtle/70 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                  // Shorter on the right, where the title bar and status bar share the edge.
                  onRight
                    ? 'max-h-[calc(100dvh-10rem)]'
                    : 'max-h-[calc(100dvh-6rem)]'
                }`
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
                      <kbd className="flex min-w-[18px] items-center justify-center rounded-[4px] border border-background/20 bg-background/10 px-1 py-[1px] font-sans font-semibold text-[10px] text-background/80">
                        {hotkey}
                      </kbd>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}

          <Tooltip>
            <TooltipTrigger
              aria-label={strings.canvas.toolbar.ruler}
              aria-pressed={rulerVisible}
              className={`shrink-0 cursor-pointer rounded-lg ${buttonPadClass} transition-colors ${
                rulerVisible
                  ? 'bg-accent-dark text-text-on-dark'
                  : 'bg-transparent text-text-secondary hover:bg-hover-tint'
              }`}
              onClick={onToggleRuler}
            >
              <RulerIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>
              <p>{strings.canvas.toolbar.ruler}</p>
            </TooltipContent>
          </Tooltip>

          <div className={`shrink-0 ${dividerClass}`} />

          <Tooltip>
            <TooltipTrigger
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
            ref={optionsPanelRef}
            {...optionsPresence.state}
            onAnimationEnd={optionsPresence.onAnimationEnd}
            className={`data-closed:fade-out-0 data-open:fade-in-0 duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] data-closed:animate-out data-open:animate-in ${
              IS_PHONE_BUILD
                ? 'data-closed:slide-out-to-bottom-2 data-open:slide-in-from-bottom-2'
                : onRight
                  ? 'data-closed:slide-out-to-right-2 data-open:slide-in-from-right-2 mr-2'
                  : 'data-closed:slide-out-to-left-2 data-open:slide-in-from-left-2 ml-2'
            } ${optionsAnchorClass}`}
            style={IS_PHONE_BUILD ? undefined : { top: optionsPanelOffset }}
          >
            <ToolOptionsPanel
              options={activeOptions}
              customColorTool={getCustomColorTool(tools[selectedToolIndex])}
              containerRef={optionsPanelContentRef}
              savePresetDisabledReason={savePresetDisabledReason}
              onSavePreset={onSavePreset}
              editingPreset={editingPresetId !== null}
            />
          </div>
        )}

        {shelfOpen && (
          <div
            className={
              IS_PHONE_BUILD
                ? panelAnchorClass
                : onRight
                  ? 'absolute right-full bottom-0 mr-2'
                  : 'absolute bottom-0 left-full ml-2'
            }
          >
            <ToolShelf
              tools={tools}
              enabledIndices={wheelEnabledIndices}
              presets={presets}
              wheelPresetIds={wheelPresetIds}
              wheelFull={wheelFull}
              savePresetDisabledReason={savePresetDisabledReason}
              onToggle={onToggleWheelTool}
              onSavePreset={onSavePreset}
              onTogglePresetInWheel={onTogglePresetInWheel}
              onClose={onCloseShelf}
              containerRef={toolbarRef}
            />
          </div>
        )}

        {!shelfOpen && embedComposer && (
          <div
            className={panelAnchorClass}
            style={
              IS_PHONE_BUILD ? undefined : { paddingTop: insertPanelOffset }
            }
          >
            {embedComposer}
          </div>
        )}

        {insertOpen && !shelfOpen && (
          <div
            className={panelAnchorClass}
            style={
              IS_PHONE_BUILD ? undefined : { paddingTop: insertPanelOffset }
            }
          >
            {insertPopover}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
});
