import { PaneIdProvider, useWindowState } from '@/lib/tabs/context';
import type { PaneNode } from '@/lib/tabs/types';
import { EmptyEditor } from './empty-editor';
import { LibrarySidebar } from './library-sidebar';
import { PaneContent } from './pane';
import { PaneDropTarget, PaneLayout } from './pane-layout';
import { TabBar } from './tab-bar';

export function AppShell() {
  const windowState = useWindowState();
  const hasSplits = windowState.layout.type === 'split';
  const pane: PaneNode | null =
    windowState.layout.type === 'pane' ? windowState.layout : null;
  const activeTab = pane
    ? (pane.tabs.find((t) => t.id === pane.activeTabId) ?? null)
    : null;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <LibrarySidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {hasSplits ? (
          <PaneLayout />
        ) : (
          pane && (
            <PaneIdProvider paneId={pane.id}>
              <TabBar pane={pane} isFocused isTopRight windowDraggable />
              <PaneDropTarget paneId={pane.id} className="min-h-0 flex-1">
                {activeTab ? <PaneContent tab={activeTab} /> : <EmptyEditor />}
              </PaneDropTarget>
            </PaneIdProvider>
          )
        )}
      </div>
    </div>
  );
}
