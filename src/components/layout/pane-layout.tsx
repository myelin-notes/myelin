import { Fragment, memo, type ReactNode, useCallback, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  PaneIdProvider,
  useTabController,
  useWindowState,
} from '@/lib/tabs/context';
import { getTabDragData, TAB_DRAG_MIME } from '@/lib/tabs/drag';
import type {
  LayoutNode,
  PaneId,
  PaneNode,
  SplitDirection,
} from '@/lib/tabs/types';
import { cn } from '@/lib/utils';
import { PaneContent } from './pane';
import { PaneTabBar } from './pane-tab-bar';

type SplitEdge = 'left' | 'right' | 'top' | 'bottom';

interface SplitIntent {
  edge: SplitEdge;
  direction: SplitDirection;
  placement: 'before' | 'after';
}

type DragIntent = SplitIntent | { edge: 'center' };

function dragIntentForPoint(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): DragIntent {
  const edgeSize = Math.min(rect.width, rect.height) * 0.38;
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
    return { edge: 'center' };
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
      return 'inset-y-1 left-1 w-[45%]';
    case 'right':
      return 'inset-y-1 right-1 w-[45%]';
    case 'top':
      return 'top-1 inset-x-1 h-[45%]';
    case 'bottom':
      return 'bottom-1 inset-x-1 h-[45%]';
  }
}

const splitEdgeIcon: Record<SplitEdge, LucideIcon> = {
  left: ArrowLeft,
  right: ArrowRight,
  top: ArrowUp,
  bottom: ArrowDown,
};

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
  const [dragIntent, setDragIntent] = useState<DragIntent | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) {
      return;
    }

    if (isPaneTabBarEvent(e)) {
      setDragIntent(null);
      return;
    }

    const intent = dragIntentForPoint(
      e.currentTarget.getBoundingClientRect(),
      e.clientX,
      e.clientY,
    );
    setDragIntent(intent);

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
    setDragIntent(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const intent =
        dragIntent ??
        dragIntentForPoint(
          e.currentTarget.getBoundingClientRect(),
          e.clientX,
          e.clientY,
        );

      const data = getTabDragData(e.dataTransfer);
      if (!data) {
        setDragIntent(null);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setDragIntent(null);

      if (intent.edge === 'center') {
        controller.moveTab(data.tabId, data.sourcePaneId, paneId, Infinity);
      } else {
        controller.splitPaneWithTab(
          paneId,
          intent.direction,
          data.tabId,
          intent.placement,
        );
      }
    },
    [controller, paneId, dragIntent],
  );

  const splitIntent =
    dragIntent && dragIntent.edge !== 'center' ? dragIntent : null;
  const showCenter = dragIntent?.edge === 'center';

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
      <AnimatePresence>
        {splitIntent && <SplitPreview key={splitIntent.edge} intent={splitIntent} />}
        {showCenter && <CenterPreview key="center" />}
      </AnimatePresence>
    </div>
  );
}

function SplitPreview({ intent }: { intent: SplitIntent }) {
  const Icon = splitEdgeIcon[intent.edge];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className={cn(
        'pointer-events-none absolute z-50 flex items-center justify-center rounded-md bg-accent-dark/12 ring-2 ring-accent-dark/30',
        splitPreviewClass(intent.edge),
      )}
    >
      <Icon className="size-5 text-accent-dark/50" />
    </motion.div>
  );
}

function CenterPreview() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1, ease: 'easeOut' }}
      className="pointer-events-none absolute inset-1 z-50 rounded-md bg-accent-dark/6 ring-1 ring-accent-dark/15"
    />
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
