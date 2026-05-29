import { memo } from 'react';
import { BookOpen, HelpCircle, Plus, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { Logo } from '@/components/logo';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import { useTabController, useWindowState } from '@/lib/tabs/context';
import type { TabTarget } from '@/lib/tabs/types';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  target: TabTarget;
}

function NavButton({
  item,
  isActive,
  onClick,
}: {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={item.label}
      aria-current={isActive ? 'page' : undefined}
      title={item.label}
      className={cn(
        'group flex cursor-pointer items-center justify-center gap-3 border-l-2 px-2 py-2 text-left transition-colors duration-150 active:translate-x-px active:opacity-70 md:justify-start md:pl-2.5',
        isActive ? 'border-accent-navy' : 'border-transparent',
      )}
    >
      <span
        className={cn(
          'transition-colors duration-150',
          isActive
            ? 'text-accent-navy'
            : 'text-text-secondary group-hover:text-text-primary',
        )}
      >
        {item.icon}
      </span>
      <span
        className={cn(
          'hidden text-xs uppercase tracking-[0.6px] transition-colors duration-150 md:inline',
          isActive
            ? 'font-semibold text-accent-navy tracking-[0.8px]'
            : 'font-normal text-text-secondary group-hover:text-text-primary',
        )}
      >
        {item.label}
      </span>
    </button>
  );
}

const logger = new Logger('Sidebar');

function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNavItemActive(
  target: TabTarget,
  focusedTabTarget: TabTarget | null,
): boolean {
  if (!focusedTabTarget) {
    return false;
  }
  return target.type === focusedTabTarget.type;
}

export const Sidebar = memo(function Sidebar() {
  const strings = useMessages();
  const repository = useRepository();
  const tabController = useTabController();
  const windowState = useWindowState();

  const focusedPane = tabController.getPane(windowState.focusedPaneId);
  const activeTab = focusedPane
    ? (focusedPane.tabs.find((t) => t.id === focusedPane.activeTabId) ?? null)
    : null;
  const focusedTarget = activeTab?.target ?? null;

  const mainNav: NavItem[] = [
    {
      label: strings.sidebar.nav.library,
      icon: <BookOpen className="size-4" />,
      active: true,
      target: { type: 'library' },
    },
  ];

  const bottomNav: NavItem[] = [
    {
      label: strings.sidebar.nav.settings,
      icon: <Settings className="size-4" />,
      target: { type: 'settings' },
    },
    {
      label: strings.sidebar.nav.help,
      icon: <HelpCircle className="size-4" />,
      target: { type: 'settings' },
    },
  ];

  const handleNewCanvas = async () => {
    try {
      const name = await repository.getUniqueFileName(
        strings.library.createNew.untitledCanvas,
        null,
      );
      const id = await repository.createFile(name, 'mcanvas', null);
      tabController.openTab({ type: 'canvas', id }, name);
    } catch (error) {
      logger.error('Failed to create note from sidebar', error);
      toast.error(strings.commandPalette.errors.createNote, {
        description: errorDescription(error),
      });
    }
  };

  return (
    <aside
      aria-label={strings.sidebar.nav.library}
      data-tauri-drag-region
      className="flex w-20 shrink-0 flex-col bg-sidebar-bg px-3 pt-12 pb-3 md:w-64 md:px-6 md:pb-6"
    >
      {/* Brand — collapses to logo mark below md */}
      <div className="flex flex-col items-center gap-1 pb-4 md:items-start">
        <h2
          className="font-heading text-text-brand text-xl italic"
          title={strings.app.name}
        >
          <Logo size={28} className="md:hidden" />
          <span className="hidden md:inline">{strings.app.name}</span>
        </h2>
        <span className="hidden font-normal text-text-secondary text-xs uppercase tracking-[0.6px] md:inline">
          {strings.app.tagline}
        </span>
      </div>

      {/* New Canvas */}
      <button
        type="button"
        onClick={handleNewCanvas}
        aria-label={strings.sidebar.newCanvas}
        title={strings.sidebar.newCanvas}
        className="group flex cursor-pointer items-center justify-center gap-2 rounded-md bg-gradient-to-b from-primary-container to-accent-dark px-2 py-2.5 transition-shadow duration-150 hover:shadow-ambient md:px-4"
      >
        <Plus className="size-3.5 text-text-on-dark" />
        <span className="hidden font-medium text-text-on-dark text-xs uppercase tracking-[0.6px] md:inline">
          {strings.sidebar.newCanvas}
        </span>
      </button>

      {/* Main Nav */}
      <nav className="flex flex-1 flex-col pt-6">
        <div className="flex flex-col">
          {mainNav.map((item) => {
            const isActive = isNavItemActive(item.target, focusedTarget);
            return (
              <NavButton
                key={item.label}
                item={item}
                isActive={isActive}
                onClick={() => tabController.openTab(item.target, item.label)}
              />
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom Nav */}
        <div className="flex flex-col pt-8">
          {bottomNav.map((item) => {
            const isActive = isNavItemActive(item.target, focusedTarget);
            return (
              <NavButton
                key={item.label}
                item={item}
                isActive={isActive}
                onClick={() => tabController.openTab(item.target, item.label)}
              />
            );
          })}
        </div>
      </nav>
    </aside>
  );
});
