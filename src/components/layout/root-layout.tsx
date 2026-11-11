import { AppShell } from './app-shell';
import { Sidebar } from './sidebar';
import { useSidebar } from './sidebar/context';
import { SidebarDrawer } from './sidebar/drawer';
import { SidebarResizeHandle } from './sidebar/resize-handle';

export function RootLayout() {
  const { collapsed, isCompact, mobileLayout } = useSidebar();
  const showColumn = !mobileLayout && !isCompact && !collapsed;

  return (
    // Isolated so in-app z-indexes (canvas chrome is z-100+) can't climb over body-portaled dialogs.
    <div className="isolate flex h-full w-full overflow-hidden">
      {showColumn && <Sidebar />}
      {showColumn && <SidebarResizeHandle />}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppShell />
      </div>
      {!mobileLayout && isCompact && <SidebarDrawer />}
    </div>
  );
}
