import { AppShell } from './app-shell';
import { Sidebar } from './sidebar';
import { useSidebar } from './sidebar/context';
import { SidebarResizeHandle } from './sidebar/resize-handle';

/**
 * Top-level window layout: a persistent left sidebar (explorer, search, tags,
 * sync status) beside the tabbed main area. The sidebar can be collapsed from
 * the tab bar, in which case the main area spans the full width, and resized by
 * dragging the divider between them.
 */
export function RootLayout() {
  const { collapsed } = useSidebar();

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {!collapsed && <Sidebar />}
      {!collapsed && <SidebarResizeHandle />}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppShell />
      </div>
    </div>
  );
}
