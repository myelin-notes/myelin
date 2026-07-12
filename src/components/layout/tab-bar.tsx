import { memo, useCallback, useRef, useState } from 'react';
import {
  Columns2,
  Network,
  PanelLeft,
  Plus,
  Rows2,
  Settings,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { errorDescription } from '@/components/command-palette/utils';
import { useSidebar } from '@/components/layout/sidebar/context';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { trackEvent } from '@/lib/analytics';
import { type Messages, useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { createBlankCanvasFile } from '@/lib/note/create';
import {
  isMac,
  isWindows,
  TAB_BAR_HEIGHT_CLASS,
  TRAFFIC_LIGHT_INSET_CLASS,
} from '@/lib/platform';
import { useRepository } from '@/lib/sync';
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
import { cn } from '@/lib/utils';
import { WindowControls } from './window-controls';

const logger = new Logger('TabBar');

// Built-in tabs store a title captured at creation time, so they don't follow
// language changes. Derive their title from the current messages instead and
// fall back to the stored title for content tabs (canvas/image file names).
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
    <motion.div
      layout
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 12, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="mb-1 flex shrink-0 items-center justify-center overflow-hidden"
    >
      <div className="h-5 w-0.5 rounded-full bg-accent-dark" />
    </motion.div>
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
  const repository = useRepository();
  const {
    collapsed,
    isCompact,
    drawerOpen,
    toggle: toggleSidebar,
  } = useSidebar();
  // In compact layout the sidebar is an overlay drawer; elsewhere it's the
  // persistent column. `sidebarShown` unifies both for the toggle's a11y state.
  const sidebarShown = isCompact ? drawerOpen : !collapsed;
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragTabId, setDragTabId] = useState<TabId | null>(null);

  // The "+" button creates a fresh canvas note in the library root and opens it
  // in this pane. Closing every tab returns the pane to the home view.
  const handleNewTab = useCallback(() => {
    void (async () => {
      try {
        const name = await repository.getUniqueFileName(
          strings.library.createNew.untitledCanvas,
          null,
        );
        const id = await createBlankCanvasFile(repository, name, null);
        controller.openTab({ type: 'canvas', id }, name, pane.id);
        trackEvent('note_created', { file_type: 'mcanvas' });
      } catch (error) {
        logger.error('Failed to create note from tab bar', error);
        toast.error(strings.commandPalette.errors.createNote, {
          description: errorDescription(error),
        });
      }
    })();
  }, [
    controller,
    pane.id,
    repository,
    strings.commandPalette.errors.createNote,
    strings.library.createNew.untitledCanvas,
  ]);

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
        // The sidebar column normally clears the macOS traffic lights; inset
        // the top-left bar whenever that column isn't present (collapsed, or
        // reflowed into the compact overlay drawer).
        isMac &&
          isTopLeft &&
          (collapsed || isCompact) &&
          TRAFFIC_LIGHT_INSET_CLASS,
      )}
    >
      {/* The sidebar lives on the window's left edge, so its toggle sits at the
          top-left — only on the leftmost pane's bar, so split views don't show
          duplicate toggles. When collapsed on macOS the whole bar insets to
          clear the traffic lights, leaving the toggle just right of them. */}
      {isTopLeft && (
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
      )}

      <div
        className="flex min-w-0 items-end gap-px overflow-x-auto pl-2"
        style={{ scrollbarWidth: 'none' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <AnimatePresence initial={false}>
          {pane.tabs.map((tab, i) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === pane.activeTabId}
              isDragging={tab.id === dragTabId}
              paneId={pane.id}
              showDropIndicator={dropIndex === i}
              onDragStateChange={setDragTabId}
            />
          ))}
          {dropIndex === pane.tabs.length && <DropIndicator key="drop-end" />}
        </AnimatePresence>
      </div>

      {/* Kept outside the scroll strip so it stays beside the tabs and never
          scrolls off when they overflow. */}
      <button
        type="button"
        onClick={handleNewTab}
        aria-label="New tab"
        className="mb-1 ml-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
      >
        <Plus className="size-3.5" />
      </button>

      <div className="flex-1 self-stretch" {...dragRegion} />

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
      <AnimatePresence initial={false}>
        {showDropIndicator && <DropIndicator key="drop" />}
      </AnimatePresence>
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
