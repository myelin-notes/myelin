import { memo, useCallback, useState } from 'react';
import { BookOpen, Columns2, Plus, Rows2, Settings, X } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useTabController, useWindowState } from '@/lib/tabs/context';
import {
  computeTabDropIndex,
  getTabDragData,
  setTabDragData,
  TAB_DRAG_MIME,
} from '@/lib/tabs/drag';
import { isTabDragOutsideWindow, spawnWindow } from '@/lib/tabs/multi-window';
import type { Tab, TabTarget } from '@/lib/tabs/types';
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

export const TabBar = memo(function TabBar() {
  const controller = useTabController();
  const windowState = useWindowState();
  const pane = controller.getPane(windowState.focusedPaneId);

  const tabs = pane?.tabs ?? [];
  const activeTabId = pane?.activeTabId ?? null;
  const paneId = pane?.id ?? windowState.focusedPaneId;
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleNewTab = useCallback(() => {
    controller.openTab({ type: 'library' }, 'Library');
  }, [controller]);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      setDropIndex(
        computeTabDropIndex(e.currentTarget, tabs.length, e.clientX),
      );
    },
    [tabs.length],
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
      e.preventDefault();

      const targetIndex = computeTabDropIndex(
        e.currentTarget,
        tabs.length,
        e.clientX,
      );

      controller.moveTab(data.tabId, data.sourcePaneId, paneId, targetIndex);
    },
    [controller, paneId, tabs.length],
  );

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 select-none items-end border-border-subtle border-b bg-surface"
    >
      <div
        className="flex min-w-0 flex-1 items-end gap-px overflow-x-auto pl-2"
        data-tauri-drag-region
        style={{ scrollbarWidth: 'none' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {tabs.map((tab, i) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            paneId={paneId}
            showDropIndicator={dropIndex === i}
          />
        ))}
        {dropIndex === tabs.length && (
          <div className="mb-1 h-5 w-0.5 shrink-0 rounded-full bg-accent-dark" />
        )}
      </div>

      <div
        className="flex shrink-0 items-center gap-1 px-2 pb-1"
        data-tauri-drag-region
      >
        <button
          type="button"
          onClick={handleNewTab}
          aria-label="New tab"
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
});

const TabItem = memo(function TabItem({
  tab,
  isActive,
  paneId,
  showDropIndicator,
}: {
  tab: Tab;
  isActive: boolean;
  paneId: string;
  showDropIndicator?: boolean;
}) {
  const controller = useTabController();

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
    },
    [tab.id, paneId],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent) => {
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
    [controller, tab, paneId],
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
      {showDropIndicator && (
        <div className="mb-1 h-5 w-0.5 shrink-0 rounded-full bg-accent-dark" />
      )}
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
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
                'group relative flex h-8 min-w-[100px] max-w-[200px] cursor-pointer items-center gap-2 px-3 transition-colors duration-150',
                isActive
                  ? '-mb-px rounded-t-lg border border-border-subtle border-b-0 bg-page text-text-primary'
                  : 'mb-0 text-text-muted hover:text-text-secondary',
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
