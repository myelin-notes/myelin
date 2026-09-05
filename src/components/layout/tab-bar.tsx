import { memo, useCallback, useRef, useState } from 'react';
import {
  Columns2,
  Home,
  MoreHorizontal,
  Network,
  PanelLeft,
  Rows2,
  Settings,
  X,
} from 'lucide-react';
import { type Messages, useMessages } from '@myelin/editor/i18n';
import { keybindings } from '@myelin/editor/keybinds';
import { cn } from '@myelin/editor/utils';
import {
  isMac,
  isWindows,
  TAB_BAR_HEIGHT_CLASS,
  TRAFFIC_LIGHT_INSET_CLASS,
} from '@myelin/shared/os';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@myelin/ui/context-menu';
import { useSidebar } from '@/components/layout/sidebar/context';
import { trackEvent } from '@/lib/analytics';
import { useTabController } from '@/lib/tabs/context';
import {
  computeTabDropIndex,
  getTabDragData,
  setTabDragData,
  setupDragGhost,
  TAB_DRAG_MIME,
} from '@/lib/tabs/drag';
import {
  dropTabOntoWindow,
  isTabDragOutsideWindow,
  spawnWindow,
} from '@/lib/tabs/multi-window';
import type { PaneNode, Tab, TabId, TabTarget } from '@/lib/tabs/types';
import { UpdateButton } from './update-button';
import { WindowControls } from './window-controls';

// Built-in tabs store a title captured at creation time, so they don't follow language changes.
// Content tabs (canvas/image file names) fall back to the stored title.
function tabTitle(tab: Tab, strings: Messages): string {
  switch (tab.target.type) {
    case 'graph':
      return strings.graph.title;
    case 'settings':
      return strings.tabBar.settings;
    default:
      return tab.title;
  }
}

function tabIcon(target: TabTarget) {
  switch (target.type) {
    case 'graph':
      return <Network className="size-3 shrink-0" />;
    case 'settings':
      return <Settings className="size-3 shrink-0" />;
    default:
      return null;
  }
}

function DropIndicator() {
  return (
    <div className="fade-in-0 mb-1 flex w-3 shrink-0 animate-in items-center justify-center overflow-hidden duration-150">
      <div className="h-5 w-0.5 rounded-full bg-accent-dark" />
    </div>
  );
}

interface TabBarProps {
  pane: PaneNode;
  isFocused: boolean;
  isTopLeft: boolean;
  isTopRight: boolean;
  windowDraggable: boolean;
}

export const TabBar = memo(function TabBar({
  pane,
  isFocused,
  isTopLeft,
  isTopRight,
  windowDraggable,
}: TabBarProps) {
  const strings = useMessages();
  const controller = useTabController();
  const {
    collapsed,
    isCompact,
    mobileLayout,
    phoneLayout,
    drawerOpen,
    toggle: toggleSidebar,
  } = useSidebar();
  // In compact layout the sidebar is an overlay drawer; elsewhere it's the
  // persistent column. `sidebarShown` unifies both for the toggle's a11y state.
  const sidebarShown = isCompact ? drawerOpen : !collapsed;
  // Mobile layout has no sidebar; the top-left button returns to the full-page library home instead
  // of toggling one, and is "active" while the pane already shows home.
  const showingHome = pane.activeTabId === '';
  const activeTab =
    pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? null;
  const showLibrary = useCallback(() => {
    controller.showHome(pane.id);
  }, [controller, pane.id]);
  // Mobile has no keyboard for Cmd/Ctrl+P, which is otherwise the palette's
  // only way in — and with it the only route to several commands.
  const openCommandPalette = useCallback(() => {
    keybindings.runAction('app:command-palette');
  }, []);
  const toggleGraph = useCallback(() => {
    controller.togglePanePage('graph', pane.id);
  }, [controller, pane.id]);
  const toggleSettings = useCallback(() => {
    controller.togglePanePage('settings', pane.id);
  }, [controller, pane.id]);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragTabId, setDragTabId] = useState<TabId | null>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      setDropIndex(
        computeTabDropIndex(e.currentTarget, pane.tabs.length, e.clientX),
      );
    },
    [pane.tabs.length],
  );

  const handleDragLeave = useCallback(() => {
    setDropIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setDropIndex(null);
      const data = getTabDragData(e.dataTransfer);
      if (!data) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();

      const targetIndex = computeTabDropIndex(
        e.currentTarget,
        pane.tabs.length,
        e.clientX,
      );

      controller.moveTab(data.tabId, data.sourcePaneId, pane.id, targetIndex);
    },
    [controller, pane.id, pane.tabs.length],
  );

  const dragRegion = windowDraggable ? { 'data-tauri-drag-region': '' } : {};

  return (
    <div
      data-pane-tab-bar
      {...dragRegion}
      className={cn(
        'flex shrink-0 select-none items-end border-border-subtle border-b bg-surface',
        TAB_BAR_HEIGHT_CLASS,
        !isFocused && 'opacity-75',
        // The sidebar column normally clears the macOS traffic lights; inset the top-left bar whenever
        // that column isn't present (collapsed, or reflowed into the compact overlay drawer).
        isMac &&
          isTopLeft &&
          (collapsed || isCompact) &&
          TRAFFIC_LIGHT_INSET_CLASS,
      )}
    >
      {/* The sidebar lives on the window's left edge, so its toggle sits at the
          top-left — only on the leftmost pane's bar, so split views don't show
          duplicate toggles. When collapsed on macOS the whole bar insets to
          clear the traffic lights, leaving the toggle just right of them. On
          mobile there's no sidebar, so this button returns to the library. */}
      {isTopLeft &&
        (mobileLayout ? (
          <button
            type="button"
            onClick={showLibrary}
            aria-label={strings.library.title}
            title={strings.library.title}
            aria-pressed={showingHome}
            className="mb-1 ml-2 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary aria-pressed:text-text-primary"
          >
            <Home className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={
              sidebarShown ? strings.sidebar.collapse : strings.sidebar.expand
            }
            title={
              sidebarShown ? strings.sidebar.collapse : strings.sidebar.expand
            }
            aria-pressed={sidebarShown}
            className="mb-1 ml-2 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
          >
            <PanelLeft className="size-3.5" />
          </button>
        ))}

      {/* Desktop reaches the palette by its shortcut, so the button is mobile-
          only. Leftmost pane only, like the button above it. */}
      {isTopLeft && mobileLayout && (
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label={strings.commandPalette.title}
          title={strings.commandPalette.title}
          className="mb-1 ml-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      )}

      {/* Phones hold one document per pane (see TabControllerOptions.singleTab),
          so there's nothing to switch between — the strip becomes the active
          document's title. It also drops tab drag/reorder and the split context
          menu, none of which work by touch anyway. */}
      {phoneLayout ? (
        <div className="mb-1 flex h-6 min-w-0 flex-1 items-center justify-center px-2">
          <span className="truncate font-medium text-[11px] text-text-primary">
            {activeTab ? tabTitle(activeTab, strings) : strings.library.title}
          </span>
        </div>
      ) : (
        <div
          className="flex min-w-0 items-end gap-px overflow-x-auto overflow-y-hidden pl-2"
          style={{ scrollbarWidth: 'none' }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {pane.tabs.map((tab, i) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={
                pane.activePage === undefined && tab.id === pane.activeTabId
              }
              isDragging={tab.id === dragTabId}
              paneId={pane.id}
              showDropIndicator={dropIndex === i}
              onDragStateChange={setDragTabId}
            />
          ))}
          {dropIndex === pane.tabs.length && <DropIndicator key="drop-end" />}
        </div>
      )}

      {!phoneLayout && <div className="flex-1 self-stretch" {...dragRegion} />}

      {isTopRight && !mobileLayout && (
        <div className="flex shrink-0 items-center gap-0.5 self-stretch px-2">
          <button
            type="button"
            onClick={toggleGraph}
            aria-label={strings.sidebar.graph}
            title={strings.sidebar.graph}
            aria-pressed={pane.activePage === 'graph'}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary aria-pressed:bg-hover-tint aria-pressed:text-text-primary"
          >
            <Network className="size-4" />
          </button>
          <button
            type="button"
            onClick={toggleSettings}
            aria-label={strings.tabBar.settings}
            title={strings.tabBar.settings}
            aria-pressed={pane.activePage === 'settings'}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary aria-pressed:bg-hover-tint aria-pressed:text-text-primary"
          >
            <Settings className="size-4" />
          </button>
        </div>
      )}

      {/* Only the top-right bar, so split views don't repeat it. */}
      {isTopRight && <UpdateButton />}

      {/* Frameless Windows has no native title bar, so the top-right pane's
          bar carries the window controls (sits right of the utility buttons). */}
      {isWindows && isTopRight && <WindowControls />}
    </div>
  );
});

const TabItem = memo(function TabItem({
  tab,
  isActive,
  isDragging,
  paneId,
  showDropIndicator,
  onDragStateChange,
}: {
  tab: Tab;
  isActive: boolean;
  isDragging: boolean;
  paneId: string;
  showDropIndicator?: boolean;
  onDragStateChange: (tabId: TabId | null) => void;
}) {
  const controller = useTabController();
  const strings = useMessages();
  const tabRef = useRef<HTMLDivElement>(null);
  const title = tabTitle(tab, strings);

  const handleClick = useCallback(() => {
    controller.activateTab(tab.id, paneId);
  }, [controller, tab.id, paneId]);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      controller.closeTab(tab.id, paneId);
    },
    [controller, tab.id, paneId],
  );

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        controller.closeTab(tab.id, paneId);
      }
    },
    [controller, tab.id, paneId],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      setTabDragData(e.dataTransfer, { tabId: tab.id, sourcePaneId: paneId });
      e.dataTransfer.effectAllowed = 'move';
      if (tabRef.current) {
        setupDragGhost(e, tabRef.current);
      }
      onDragStateChange(tab.id);
    },
    [tab.id, paneId, onDragStateChange],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent) => {
      onDragStateChange(null);
      if (
        e.dataTransfer.dropEffect !== 'none' ||
        !isTabDragOutsideWindow(e.nativeEvent)
      ) {
        return;
      }

      // Screen coords are read synchronously; the native event is reused once
      // the handler returns.
      const { screenX, screenY } = e.nativeEvent;
      void (async () => {
        try {
          const adopted = await dropTabOntoWindow(tab, screenX, screenY);
          if (!adopted) {
            await spawnWindow(tab);
            trackEvent('window_spawned', { target_type: tab.target.type });
          }
          controller.closeTab(tab.id, paneId);
        } catch {
          // Leave the tab in place if the transfer/spawn failed.
        }
      })();
    },
    [controller, tab, paneId, onDragStateChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        controller.activateTab(tab.id, paneId);
      }
    },
    [controller, tab.id, paneId],
  );

  const handleSplitRight = useCallback(() => {
    controller.splitPaneWithTab(paneId, 'horizontal', tab.id);
  }, [controller, paneId, tab.id]);

  const handleSplitDown = useCallback(() => {
    controller.splitPaneWithTab(paneId, 'vertical', tab.id);
  }, [controller, paneId, tab.id]);

  const icon = tabIcon(tab.target);

  return (
    <>
      {showDropIndicator && <DropIndicator key="drop" />}
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              ref={tabRef}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              draggable
              data-tab-id={tab.id}
              onClick={handleClick}
              onKeyDown={handleKeyDown}
              onMouseDown={handleMiddleClick}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              className={cn(
                'group relative flex h-8 min-w-[100px] max-w-[200px] items-center gap-2 px-3 transition-[colors,opacity] duration-150',
                isActive
                  ? '-mb-px rounded-t-lg border border-border-subtle border-b-0 bg-page text-text-primary'
                  : 'mb-0 text-text-muted hover:text-text-secondary',
                isDragging && 'opacity-30',
              )}
            />
          }
        >
          {icon}
          <span className="min-w-0 flex-1 truncate font-medium text-[11px]">
            {title}
          </span>
          <button
            type="button"
            onClick={handleClose}
            aria-label={`Close ${title}`}
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded transition-colors duration-150',
              isActive
                ? 'text-text-muted hover:bg-hover-tint hover:text-text-primary'
                : 'text-transparent group-hover:text-text-muted group-hover:hover:text-text-primary',
            )}
          >
            <X className="size-3" />
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleClose}>
            <X className="size-3.5" />
            Close
          </ContextMenuItem>
          <ContextMenuItem onClick={handleSplitRight}>
            <Columns2 className="size-3.5" />
            Split Right
          </ContextMenuItem>
          <ContextMenuItem onClick={handleSplitDown}>
            <Rows2 className="size-3.5" />
            Split Down
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
});
