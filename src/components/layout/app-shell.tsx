import { PaneIdProvider, useWindowState } from '@/lib/tabs/context';
import type { PaneNode } from '@/lib/tabs/types';
import { HomePage } from '@/pages/home';
import { MobileLibrary } from '@/pages/library/mobile-library';
import { PaneContent } from './pane';
import { PaneDropTarget, PaneLayout } from './pane-layout';
import { useSidebar } from './sidebar/context';
import { TabBar } from './tab-bar';

export function AppShell() {
  const windowState = useWindowState();
  const { mobileLayout } = useSidebar();
  const hasSplits = windowState.layout.type === 'split';

  if (hasSplits) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1">
          <PaneLayout />
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
    <div className="flex h-full w-full flex-col overflow-hidden">
      {pane && (
        <TabBar pane={pane} isFocused isTopLeft isTopRight windowDraggable />
      )}
      {pane && (
        <PaneIdProvider paneId={pane.id}>
          <PaneDropTarget paneId={pane.id} className="min-h-0 flex-1">
            {activeTab ? (
              <PaneContent tab={activeTab} />
            ) : mobileLayout ? (
              <MobileLibrary />
            ) : (
              <HomePage />
            )}
          </PaneDropTarget>
        </PaneIdProvider>
      )}
    </div>
  );
}
