import { PaneIdProvider, useWindowState } from '@/lib/tabs/context';
import type { PaneNode } from '@/lib/tabs/types';
import { PaneContent } from './pane';
import { PaneDropTarget, PaneLayout } from './pane-layout';
import { Sidebar } from './sidebar';
import { TabBar } from './tab-bar';

export function AppShell() {
  const windowState = useWindowState();
  const hasSplits = windowState.layout.type === 'split';

  if (hasSplits) {
    return (
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <PaneLayout />
          </div>
        </div>
      </div>
    );
  }

  const pane: PaneNode | null =
    windowState.layout.type === 'pane' ? windowState.layout : null;
  const activeTab = pane
    ? (pane.tabs.find((t) => t.id === pane.activeTabId) ?? null)
    : null;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        {activeTab && pane && (
          <PaneIdProvider paneId={pane.id}>
            <PaneDropTarget paneId={pane.id} className="min-h-0 flex-1">
              <PaneContent tab={activeTab} />
            </PaneDropTarget>
          </PaneIdProvider>
        )}
      </div>
    </div>
  );
}
