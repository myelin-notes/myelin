import { AppShell } from './app-shell';
import { Sidebar } from './sidebar';
import { useSidebar } from './sidebar/context';
import { SidebarDrawer } from './sidebar/drawer';
import { SidebarResizeHandle } from './sidebar/resize-handle';

/**
 * Top-level window layout. On roomy viewports this is a persistent left sidebar
 * (explorer, search, tags, sync status) beside the tabbed main area, resizable
 * by dragging the divider and collapsible from the tab bar. On narrow viewports
 * the sidebar reflows into an overlay drawer ({@link SidebarDrawer}) so the
 * content keeps the full width — an adaptive, screen-size-driven layout, not a
 * separate mobile UI.
 */
export function RootLayout() {
  const { collapsed, isCompact } = useSidebar();
  const showColumn = !isCompact && !collapsed;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {showColumn && <Sidebar />}
      {showColumn && <SidebarResizeHandle />}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppShell />
      </div>
      {isCompact && <SidebarDrawer />}
    </div>
  );
}
