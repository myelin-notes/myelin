import { Fragment, memo } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { PaneIdProvider, useTabController, useWindowState } from '@/lib/tabs/context';
import type { LayoutNode, PaneNode } from '@/lib/tabs/types';
import { cn } from '@/lib/utils';
import { PaneContent } from './pane';
import { PaneTabBar } from './pane-tab-bar';

function PaneView({ node }: { node: PaneNode }) {
  const windowState = useWindowState();
  const isFocused = node.id === windowState.focusedPaneId;
  const tabController = useTabController();
  const activeTab = node.tabs.find((t) => t.id === node.activeTabId) ?? null;

  return (
    <PaneIdProvider paneId={node.id}>
      <div
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
      </div>
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
                node.direction === 'horizontal'
                  ? 'w-px'
                  : 'h-px',
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
