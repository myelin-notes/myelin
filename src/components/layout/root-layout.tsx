import { cn } from '@/lib/utils';
import { AppShell } from './app-shell';
import { Sidebar } from './sidebar';
import { useSidebar } from './sidebar/context';

/**
 * Top-level window layout: a persistent left sidebar (explorer, search, tags,
 * sync status) beside the tabbed main area. The sidebar can be collapsed from
 * the tab bar, in which case the main area spans the full width.
 */
export function RootLayout() {
  const { collapsed } = useSidebar();

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {!collapsed && <Sidebar />}
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col',
          !collapsed && 'border-border-subtle border-l',
        )}
      >
        <AppShell />
      </div>
    </div>
  );
}
