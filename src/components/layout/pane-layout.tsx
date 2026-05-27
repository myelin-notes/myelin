import { Fragment, memo, type ReactNode, useCallback, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  PaneIdProvider,
  useTabController,
  useWindowState,
} from '@/lib/tabs/context';
import type {
  LayoutNode,
  PaneId,
  PaneNode,
  SplitDirection,
} from '@/lib/tabs/types';
import { cn } from '@/lib/utils';
import { PaneContent } from './pane';
import { PaneTabBar } from './pane-tab-bar';

const TAB_DRAG_MIME = 'application/myelin-tab';

type SplitEdge = 'left' | 'right' | 'top' | 'bottom';

interface SplitIntent {
  edge: SplitEdge;
  direction: SplitDirection;
  placement: 'before' | 'after';
}

function splitIntentForPoint(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): SplitIntent | null {
  const edgeSize = Math.min(
    72,
    Math.max(36, Math.min(rect.width, rect.height) * 0.18),
  );
  const distances: Array<[SplitEdge, number]> = [
    ['left', clientX - rect.left],
    ['right', rect.right - clientX],
    ['top', clientY - rect.top],
    ['bottom', rect.bottom - clientY],
  ];
  const [edge, distance] = distances.reduce((closest, candidate) =>
    candidate[1] < closest[1] ? candidate : closest,
  );

  if (distance > edgeSize) {
    return null;
  }

  switch (edge) {
    case 'left':
      return { edge, direction: 'horizontal', placement: 'before' };
    case 'right':
      return { edge, direction: 'horizontal', placement: 'after' };
    case 'top':
      return { edge, direction: 'vertical', placement: 'before' };
    case 'bottom':
      return { edge, direction: 'vertical', placement: 'after' };
  }
}

function isPaneTabBarEvent(e: React.DragEvent): boolean {
  return (
    e.target instanceof HTMLElement &&
    e.target.closest('[data-pane-tab-bar]') !== null
  );
}

function splitPreviewClass(edge: SplitEdge): string {
  switch (edge) {
    case 'left':
      return 'inset-y-2 left-2 w-[28%]';
    case 'right':
      return 'inset-y-2 right-2 w-[28%]';
    case 'top':
      return 'top-2 inset-x-2 h-[28%]';
    case 'bottom':
      return 'bottom-2 inset-x-2 h-[28%]';
  }
}

export function PaneDropTarget({
  paneId,
  className,
  children,
  onPointerDown,
}: {
  paneId: PaneId;
  className?: string;
  children: ReactNode;
  onPointerDown?: () => void;
}) {
  const controller = useTabController();
  const [splitIntent, setSplitIntent] = useState<SplitIntent | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) {
      return;
    }

    if (isPaneTabBarEvent(e)) {
      setSplitIntent(null);
      return;
    }

    const intent = splitIntentForPoint(
      e.currentTarget.getBoundingClientRect(),
      e.clientX,
      e.clientY,
    );
    setSplitIntent(intent);

    if (!intent) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (
      e.relatedTarget instanceof Node &&
      e.currentTarget.contains(e.relatedTarget)
    ) {
      return;
    }
    setSplitIntent(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const intent =
        splitIntent ??
        splitIntentForPoint(
          e.currentTarget.getBoundingClientRect(),
          e.clientX,
          e.clientY,
        );
      if (!intent) {
        return;
      }

      const raw = e.dataTransfer.getData(TAB_DRAG_MIME);
      if (!raw) {
        setSplitIntent(null);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setSplitIntent(null);

      const data = JSON.parse(raw) as {
        tabId: string;
      };

      controller.splitPaneWithTab(
        paneId,
        intent.direction,
        data.tabId,
        intent.placement,
      );
    },
    [controller, paneId, splitIntent],
  );

  return (
    <div
      data-pane-drop-target={paneId}
      className={cn('relative', className)}
      onPointerDown={onPointerDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {splitIntent && (
        <div
          className={cn(
            'pointer-events-none absolute rounded-lg bg-accent-dark/10 ring-1 ring-accent-dark/25',
            splitPreviewClass(splitIntent.edge),
          )}
        />
      )}
    </div>
  );
}

function PaneView({ node }: { node: PaneNode }) {
  const windowState = useWindowState();
  const isFocused = node.id === windowState.focusedPaneId;
  const tabController = useTabController();
  const activeTab = node.tabs.find((t) => t.id === node.activeTabId) ?? null;

  return (
    <PaneIdProvider paneId={node.id}>
      <PaneDropTarget
        paneId={node.id}
        className={cn(
          'flex h-full flex-col overflow-hidden',
          isFocused && 'ring-1 ring-accent-dark/10',
        )}
        onPointerDown={() => tabController.focusPane(node.id)}
      >
        <PaneTabBar pane={node} isFocused={isFocused} />
        <div className="min-h-0 flex-1">
          {activeTab && <PaneContent tab={activeTab} />}
        </div>
      </PaneDropTarget>
    </PaneIdProvider>
  );
}

const LayoutRenderer = memo(function LayoutRenderer({
  node,
}: {
  node: LayoutNode;
}) {
  if (node.type === 'pane') {
    return <PaneView node={node} />;
  }

  return (
    <Group orientation={node.direction}>
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <Separator
              className={cn(
                'relative flex shrink-0 items-center justify-center bg-border-divider transition-colors duration-150 hover:bg-accent-dark/15 data-[state=drag]:bg-accent-dark/20',
                node.direction === 'horizontal' ? 'w-px' : 'h-px',
              )}
            />
          )}
          <Panel defaultSize={node.sizes[i]} minSize={15}>
            <LayoutRenderer node={child} />
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
});

export function PaneLayout() {
  const windowState = useWindowState();
  return <LayoutRenderer node={windowState.layout} />;
}
