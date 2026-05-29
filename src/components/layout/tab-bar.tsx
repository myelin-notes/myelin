import { memo, useCallback, useRef, useState } from 'react';
import { BookOpen, Columns2, Plus, Rows2, Settings, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useMessages } from '@/lib/i18n';
import {
  isMac,
  TAB_BAR_HEIGHT_CLASS,
  TRAFFIC_LIGHT_INSET_CLASS,
} from '@/lib/platform';
import { useTabController } from '@/lib/tabs/context';
import {
  computeTabDropIndex,
  getTabDragData,
  setTabDragData,
  setupDragGhost,
  TAB_DRAG_MIME,
} from '@/lib/tabs/drag';
import { isTabDragOutsideWindow, spawnWindow } from '@/lib/tabs/multi-window';
import type { PaneNode, Tab, TabId, TabTarget } from '@/lib/tabs/types';
import { cn } from '@/lib/utils';

function tabIcon(target: TabTarget) {
  switch (target.type) {
    case 'library':
      return <BookOpen className="size-3 shrink-0" />;
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
  windowDraggable: boolean;
}

export const TabBar = memo(function TabBar({
  pane,
  isFocused,
  isTopLeft,
  windowDraggable,
}: TabBarProps) {
  const strings = useMessages();
  const controller = useTabController();
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragTabId, setDragTabId] = useState<TabId | null>(null);

  const handleNewTab = useCallback(() => {
    controller.openTab({ type: 'library' }, 'Library', pane.id);
  }, [controller, pane.id]);

  const handleSettings = useCallback(() => {
    controller.openTab(
      { type: 'settings' },
      strings.sidebar.nav.settings,
      pane.id,
    );
  }, [controller, pane.id, strings.sidebar.nav.settings]);

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
        isMac && isTopLeft && TRAFFIC_LIGHT_INSET_CLASS,
      )}
    >
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

      <div
        className="flex shrink-0 items-center gap-1 px-2 pb-1"
        {...dragRegion}
      >
        <button
          type="button"
          onClick={handleSettings}
          aria-label={strings.sidebar.nav.settings}
          title={strings.sidebar.nav.settings}
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
        >
          <Settings className="size-3.5" />
        </button>
      </div>
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
  const tabRef = useRef<HTMLDivElement>(null);

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
        e.dataTransfer.dropEffect === 'none' &&
        isTabDragOutsideWindow(e.nativeEvent)
      ) {
        void spawnWindow(tab)
          .then(() => {
            controller.closeTab(tab.id, paneId);
          })
          .catch(() => undefined);
      }
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
                'group relative flex h-8 min-w-[100px] max-w-[200px] cursor-grab items-center gap-2 px-3 transition-[colors,opacity] duration-150 active:cursor-grabbing',
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
            {tab.title}
          </span>
          <button
            type="button"
            onClick={handleClose}
            aria-label={`Close ${tab.title}`}
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
