import { memo, useCallback, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTabController } from '@/lib/tabs/context';
import type { PaneNode, Tab } from '@/lib/tabs/types';
import { cn } from '@/lib/utils';

const TAB_DRAG_MIME = 'application/myelin-tab';

interface PaneTabBarProps {
  pane: PaneNode;
  isFocused: boolean;
}

export const PaneTabBar = memo(function PaneTabBar({
  pane,
  isFocused,
}: PaneTabBarProps) {
  const controller = useTabController();
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleNewTab = useCallback(() => {
    controller.openTab({ type: 'library' }, 'Library', pane.id);
  }, [controller, pane.id]);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const tabElements = (e.currentTarget as HTMLElement).querySelectorAll(
        '[data-tab-id]',
      );
      let closest = pane.tabs.length;
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
    [pane.tabs.length],
  );

  const handleDragLeave = useCallback(() => {
    setDropIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setDropIndex(null);
      const raw = e.dataTransfer.getData(TAB_DRAG_MIME);
      if (!raw) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();

      const data = JSON.parse(raw) as {
        tabId: string;
        sourcePaneId: string;
      };

      const tabElements = (e.currentTarget as HTMLElement).querySelectorAll(
        '[data-tab-id]',
      );
      let targetIndex = pane.tabs.length;
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

      controller.moveTab(data.tabId, data.sourcePaneId, pane.id, targetIndex);
    },
    [controller, pane.id, pane.tabs.length],
  );

  return (
    <div
      data-pane-tab-bar
      className={cn(
        'flex h-8 shrink-0 items-center gap-px bg-sidebar-bg',
        !isFocused && 'opacity-80',
      )}
    >
      <div
        className="flex min-w-0 flex-1 items-end gap-px overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {pane.tabs.map((tab, i) => (
          <PaneTabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === pane.activeTabId}
            paneId={pane.id}
            showDropIndicator={dropIndex === i}
          />
        ))}
        {dropIndex === pane.tabs.length && (
          <div className="h-5 w-0.5 shrink-0 rounded-full bg-accent-dark" />
        )}
      </div>
      <button
        type="button"
        onClick={handleNewTab}
        aria-label="New tab"
        className="mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
});

const PaneTabItem = memo(function PaneTabItem({
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
      e.dataTransfer.setData(
        TAB_DRAG_MIME,
        JSON.stringify({ tabId: tab.id, sourcePaneId: paneId }),
      );
      e.dataTransfer.effectAllowed = 'move';
    },
    [tab.id, paneId],
  );

  return (
    <>
      {showDropIndicator && (
        <div className="h-5 w-0.5 shrink-0 rounded-full bg-accent-dark" />
      )}
      <button
        type="button"
        draggable
        data-tab-id={tab.id}
        onClick={handleClick}
        onMouseDown={handleMiddleClick}
        onDragStart={handleDragStart}
        className={cn(
          'group flex h-7 min-w-[80px] max-w-[160px] cursor-pointer items-center gap-1.5 rounded-t px-2 transition-colors duration-150',
          isActive
            ? 'bg-card text-text-primary'
            : 'text-text-muted hover:bg-hover-tint hover:text-text-secondary',
        )}
      >
        <span className="min-w-0 flex-1 truncate font-medium text-[10px]">
          {tab.title}
        </span>
        <button
          type="button"
          onClick={handleClose}
          aria-label={`Close ${tab.title}`}
          className={cn(
            'flex size-3.5 shrink-0 items-center justify-center rounded transition-colors duration-150',
            isActive
              ? 'text-text-muted hover:text-text-primary'
              : 'text-transparent group-hover:text-text-muted',
          )}
        >
          <X className="size-2.5" />
        </button>
      </button>
    </>
  );
});
