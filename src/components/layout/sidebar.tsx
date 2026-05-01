import { BookOpen, HelpCircle, Plus, Settings } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '@/components/logo';
import { useMessages } from '@/lib/i18n';
import { useRepository } from '@/lib/sync';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  navTo: string;
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
        'group flex cursor-pointer items-center justify-center gap-3 border-l-2 px-2 py-2 text-left transition-all duration-150 active:translate-x-px active:opacity-70 md:justify-start md:pl-2.5',
        isActive ? 'border-accent-navy' : 'border-transparent',
      )}
    >
      <span
        className={cn(
          'transition-colors duration-150',
          isActive
            ? 'text-accent-navy'
            : 'text-text-muted group-hover:text-text-secondary',
        )}
      >
        {item.icon}
      </span>
      <span
        className={cn(
          'hidden text-xs uppercase tracking-[0.6px] transition-colors duration-150 md:inline',
          isActive
            ? 'font-semibold text-accent-navy tracking-[0.8px]'
            : 'font-normal text-text-muted group-hover:text-text-primary',
        )}
      >
        {item.label}
      </span>
    </button>
  );
}

export function Sidebar() {
  const strings = useMessages();
  const repository = useRepository();
  const navigate = useNavigate();
  const location = useLocation();

  const mainNav: NavItem[] = [
    {
      label: strings.sidebar.nav.library,
      icon: <BookOpen className="size-4" />,
      active: true,
      navTo: '/library',
    },
    // {
    //   label: strings.sidebar.nav.graph,
    //   icon: <Waypoints className="size-5" />,
    //   navTo: '/graph',
    // },
  ];

  const bottomNav: NavItem[] = [
    {
      label: strings.sidebar.nav.settings,
      icon: <Settings className="size-4" />,
      navTo: '/settings',
    },
    {
      label: strings.sidebar.nav.help,
      icon: <HelpCircle className="size-4" />,
      navTo: '/help',
    },
  ];

  const handleNewCanvas = async () => {
    const name = await repository.getUniqueFileName(
      strings.library.createNew.untitledCanvas,
      null,
    );
    const id = await repository.createFile(name, 'mcanvas', null);
    navigate(`/mcanvas/${id}`);
  };

  return (
    <aside
      aria-label={strings.sidebar.nav.library}
      className="fixed top-0 bottom-0 left-0 z-20 flex w-16 flex-col bg-sidebar-bg p-3 md:w-64 md:p-6"
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
        className="group flex cursor-pointer items-center justify-center gap-2 rounded-md bg-gradient-to-b from-primary-container to-accent-dark px-2 py-2.5 transition-all duration-150 hover:brightness-125 md:px-4"
      >
        <Plus className="size-3.5 text-text-on-dark transition-transform duration-150 group-hover:rotate-90" />
        <span className="hidden font-medium text-text-on-dark text-xs uppercase tracking-[0.6px] md:inline">
          {strings.sidebar.newCanvas}
        </span>
      </button>

      {/* Main Nav */}
      <nav className="flex flex-1 flex-col pt-6">
        <div className="flex flex-col">
          {mainNav.map((item) => {
            const isActive = location.pathname.startsWith(item.navTo);
            return (
              <NavButton
                key={item.label}
                item={item}
                isActive={isActive}
                onClick={() => navigate(item.navTo)}
              />
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom Nav */}
        <div className="flex flex-col pt-8">
          {bottomNav.map((item) => {
            const isActive = location.pathname.startsWith(item.navTo);
            return (
              <NavButton
                key={item.label}
                item={item}
                isActive={isActive}
                onClick={() => navigate(item.navTo)}
              />
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
