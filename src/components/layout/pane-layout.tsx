import {
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  PaneIdProvider,
  useTabController,
  useWindowState,
} from '@/lib/tabs/context';
import {
  computeTabDropIndex,
  getTabDragData,
  TAB_DRAG_MIME,
} from '@/lib/tabs/drag';
import type {
  LayoutNode,
  PaneId,
  PaneNode,
  SplitDirection,
} from '@/lib/tabs/types';
import { cn } from '@/lib/utils';
import { HomePage } from '@/pages/home';
import { PaneContent } from './pane';
import { TabBar } from './tab-bar';

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

// The drag overlay covers the whole pane, tab bar included. Report the pane's
// tab bar when the cursor is over it so drops there merge into the tab strip
// instead of being read as an edge split.
function tabBarAt(container: HTMLElement, clientY: number): HTMLElement | null {
  const bar = container.querySelector('[data-pane-tab-bar]');
  if (!(bar instanceof HTMLElement)) {
    return null;
  }
  const rect = bar.getBoundingClientRect();
  return clientY >= rect.top && clientY <= rect.bottom ? bar : null;
}

function splitLineStyle(edge: SplitEdge): React.CSSProperties {
  const line: React.CSSProperties = { position: 'absolute' };
  switch (edge) {
    case 'left':
      return { ...line, top: 0, bottom: 0, left: '50%', width: 2 };
    case 'right':
      return { ...line, top: 0, bottom: 0, right: '50%', width: 2 };
    case 'top':
      return { ...line, left: 0, right: 0, top: '50%', height: 2 };
    case 'bottom':
      return { ...line, left: 0, right: 0, bottom: '50%', height: 2 };
  }
}

function splitGradient(edge: SplitEdge): string {
  const from = 'var(--accent-dark)';
  switch (edge) {
    case 'left':
      return `linear-gradient(to right, ${from} 0%, transparent 100%)`;
    case 'right':
      return `linear-gradient(to left, ${from} 0%, transparent 100%)`;
    case 'top':
      return `linear-gradient(to bottom, ${from} 0%, transparent 100%)`;
    case 'bottom':
      return `linear-gradient(to top, ${from} 0%, transparent 100%)`;
  }
}

function splitGradientClass(edge: SplitEdge): string {
  switch (edge) {
    case 'left':
      return 'inset-y-0 left-0 w-1/2';
    case 'right':
      return 'inset-y-0 right-0 w-1/2';
    case 'top':
      return 'inset-x-0 top-0 h-1/2';
    case 'bottom':
      return 'inset-x-0 bottom-0 h-1/2';
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
  const [dragIntent, setDragIntent] = useState<DragIntent | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) {
      return;
    }
    if (isPaneTabBarEvent(e)) {
      return;
    }
    setDragIntent((prev) => prev ?? { edge: 'center' });
  }, []);

  const handleOverlayDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const container = containerRef.current;
    if (!container) {
      return;
    }

    // Hovering a tab bar always merges into that pane — the body owns the
    // split zones, the bar owns the tab strip.
    if (tabBarAt(container, e.clientY)) {
      setDragIntent({ edge: 'center' });
      return;
    }

    setDragIntent(
      dragIntentForPoint(
        container.getBoundingClientRect(),
        e.clientX,
        e.clientY,
      ),
    );
  }, []);

  const handleOverlayDragLeave = useCallback((e: React.DragEvent) => {
    const container = containerRef.current;
    if (
      container &&
      e.relatedTarget instanceof Node &&
      container.contains(e.relatedTarget)
    ) {
      return;
    }
    setDragIntent(null);
  }, []);

  const handleOverlayDrop = useCallback(
    (e: React.DragEvent) => {
      const container = containerRef.current;
      const data = getTabDragData(e.dataTransfer);
      if (!data || !container) {
        setDragIntent(null);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setDragIntent(null);

      // A drop over the tab bar merges the tab at the hovered position,
      // matching a plain tab-bar drop.
      const bar = tabBarAt(container, e.clientY);
      if (bar) {
        const index = computeTabDropIndex(
          bar,
          bar.querySelectorAll('[data-tab-id]').length,
          e.clientX,
        );
        controller.moveTab(data.tabId, data.sourcePaneId, paneId, index);
        return;
      }

      const intent =
        dragIntent ??
        dragIntentForPoint(
          container.getBoundingClientRect(),
          e.clientX,
          e.clientY,
        );

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
      ref={containerRef}
      data-pane-drop-target={paneId}
      className={cn('relative', className)}
      onPointerDown={onPointerDown}
      onDragEnter={handleDragEnter}
    >
      {children}
      {dragIntent && (
        <div
          className="absolute inset-0 z-40"
          onDragOver={handleOverlayDragOver}
          onDragLeave={handleOverlayDragLeave}
          onDrop={handleOverlayDrop}
        />
      )}
      <AnimatePresence>
        {splitIntent && (
          <SplitPreview key={splitIntent.edge} intent={splitIntent} />
        )}
        {showCenter && <CenterPreview key="center" />}
      </AnimatePresence>
    </div>
  );
}

function SplitPreview({ intent }: { intent: SplitIntent }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1, ease: 'easeOut' }}
      className="pointer-events-none absolute inset-0 z-50"
    >
      {/* Directional wash */}
      <div
        className={cn(
          'absolute opacity-[0.12]',
          splitGradientClass(intent.edge),
        )}
        style={{ background: splitGradient(intent.edge) }}
      />
      {/* Split line */}
      <div
        className="rounded-full bg-accent-dark/40"
        style={splitLineStyle(intent.edge)}
      />
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
      className="pointer-events-none absolute inset-0 z-50 rounded-md border-2 border-accent-dark/15"
    />
  );
}

function PaneView({
  node,
  isTopLeft,
  isTopRight,
}: {
  node: PaneNode;
  isTopLeft: boolean;
  isTopRight: boolean;
}) {
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
        <TabBar
          pane={node}
          isFocused={isFocused}
          isTopLeft={isTopLeft}
          isTopRight={isTopRight}
          // The top-left pane sits at the window's top-left, so its bar carries
          // the window drag handle (titleBarStyle: Overlay has no native one).
          windowDraggable={isTopLeft}
        />
        <div className="min-h-0 flex-1">
          {activeTab ? <PaneContent tab={activeTab} /> : <HomePage />}
        </div>
      </PaneDropTarget>
    </PaneIdProvider>
  );
}

const LayoutRenderer = memo(function LayoutRenderer({
  node,
  isTopLeft,
  isTopRight,
}: {
  node: LayoutNode;
  isTopLeft: boolean;
  isTopRight: boolean;
}) {
  if (node.type === 'pane') {
    return (
      <PaneView node={node} isTopLeft={isTopLeft} isTopRight={isTopRight} />
    );
  }

  const lastIndex = node.children.length - 1;

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
            <LayoutRenderer
              node={child}
              isTopLeft={isTopLeft && i === 0}
              // A horizontal split puts the top-right corner in the last child;
              // a vertical split stacks rows, so the top row (first child) owns
              // both top corners.
              isTopRight={
                isTopRight &&
                (node.direction === 'horizontal' ? i === lastIndex : i === 0)
              }
            />
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
});

export function PaneLayout() {
  const windowState = useWindowState();
  return <LayoutRenderer node={windowState.layout} isTopLeft isTopRight />;
}
