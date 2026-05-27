import { memo, useCallback, useRef, useState } from 'react';
import { BookOpen, Columns2, Plus, Rows2, Settings, X } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useTabController, useWindowState } from '@/lib/tabs/context';
import { isTabDragOutsideWindow, spawnWindow } from '@/lib/tabs/multi-window';
import type { PaneNode, Tab, TabTarget } from '@/lib/tabs/types';
import { cn } from '@/lib/utils';

const TAB_DRAG_MIME = 'application/myelin-tab';

function findFocusedPane(
  node: import('@/lib/tabs/types').LayoutNode,
  paneId: string,
): PaneNode | null {
  if (node.type === 'pane') return node.id === paneId ? node : null;
  for (const child of node.children) {
    const found = findFocusedPane(child, paneId);
    if (found) return found;
  }
  return null;
}

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
  const pane = findFocusedPane(
    windowState.layout,
    windowState.focusedPaneId,
  );

  const tabs = pane?.tabs ?? [];
  const activeTabId = pane?.activeTabId ?? null;
  const paneId = pane?.id ?? windowState.focusedPaneId;
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleNewTab = useCallback(() => {
    controller.openTab({ type: 'library' }, 'Library');
  }, [controller]);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const tabElements = (e.currentTarget as HTMLElement).querySelectorAll(
        '[data-tab-id]',
      );
      let closest = tabs.length;
      let closestDist = Infinity;

      tabElements.forEach((el, i) => {
        const rect = el.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const dist = Math.abs(e.clientX - center);
        if (dist < closestDist) {
          closestDist = dist;
          closest = e.clientX < center ? i : i + 1;
        }
      });

      setDropIndex(closest);
    },
    [tabs.length],
  );

  const handleDragLeave = useCallback(() => {
    setDropIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setDropIndex(null);
      const raw = e.dataTransfer.getData(TAB_DRAG_MIME);
      if (!raw) return;
      e.preventDefault();

      const data = JSON.parse(raw) as {
        tabId: string;
        sourcePaneId: string;
      };

      const tabElements = (e.currentTarget as HTMLElement).querySelectorAll(
        '[data-tab-id]',
      );
      let targetIndex = tabs.length;
      let closestDist = Infinity;

      tabElements.forEach((el, i) => {
        const rect = el.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const dist = Math.abs(e.clientX - center);
        if (dist < closestDist) {
          closestDist = dist;
          targetIndex = e.clientX < center ? i : i + 1;
        }
      });

      controller.moveTab(data.tabId, data.sourcePaneId, paneId, targetIndex);
    },
    [controller, paneId, tabs.length],
  );

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 select-none items-end border-b border-border-subtle bg-surface"
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

      <div className="flex shrink-0 items-center gap-1 px-2 pb-1" data-tauri-drag-region>
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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
      e.dataTransfer.setData(
        TAB_DRAG_MIME,
        JSON.stringify({ tabId: tab.id, sourcePaneId: paneId }),
      );
      e.dataTransfer.effectAllowed = 'move';
    },
    [tab.id, paneId],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent) => {
      if (e.dataTransfer.dropEffect === 'none' && isTabDragOutsideWindow(e.nativeEvent)) {
        controller.closeTab(tab.id, paneId);
        void spawnWindow(tab).catch(() => {
          controller.openTab(tab.target, tab.title);
        });
      }
    },
    [controller, tab, paneId],
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
            <button
              type="button"
              draggable
              data-tab-id={tab.id}
              onClick={handleClick}
              onMouseDown={handleMiddleClick}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              className={cn(
                'group relative flex h-8 max-w-[200px] min-w-[100px] cursor-pointer items-center gap-2 px-3 transition-colors duration-150',
                isActive
                  ? '-mb-px rounded-t-lg border border-b-0 border-border-subtle bg-page text-text-primary'
                  : 'mb-0 text-text-muted hover:text-text-secondary',
              )}
            />
          }
        >
          {icon}
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
            {tab.title}
          </span>
          <button
            ref={closeButtonRef}
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
