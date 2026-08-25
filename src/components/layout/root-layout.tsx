import { AppShell } from './app-shell';
import { Sidebar } from './sidebar';
import { useSidebar } from './sidebar/context';
import { SidebarDrawer } from './sidebar/drawer';
import { SidebarResizeHandle } from './sidebar/resize-handle';

export function RootLayout() {
  const { collapsed, isCompact, mobileLayout } = useSidebar();
  const showColumn = !mobileLayout && !isCompact && !collapsed;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {showColumn && <Sidebar />}
      {showColumn && <SidebarResizeHandle />}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppShell />
      </div>
      {!mobileLayout && isCompact && <SidebarDrawer />}
    </div>
  );
}
