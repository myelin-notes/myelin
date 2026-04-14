import {
  BookOpen,
  Bug,
  HelpCircle,
  Plus,
  Settings,
  Waypoints,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DEBUG } from '@/lib/debug';
import { repository } from '@/lib/repository';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  navTo: string;
}

const mainNav: NavItem[] = [
  {
    label: 'Library',
    icon: <BookOpen className="size-4" />,
    active: true,
    navTo: '/library',
  },
  {
    label: 'Graph',
    icon: <Waypoints className="size-5" />,
    navTo: '/graph',
  },
];

const bottomNav: NavItem[] = [
  ...(DEBUG
    ? [
        {
          label: 'Debug',
          icon: <Bug className="size-4" />,
          navTo: '/debug',
        },
      ]
    : []),
  {
    label: 'Settings',
    icon: <Settings className="size-4" />,
    navTo: '/settings',
  },
  {
    label: 'Help',
    icon: <HelpCircle className="size-4" />,
    navTo: '/help',
  },
];

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
      className={cn(
        'group flex cursor-pointer items-center gap-3 border-l-2 px-2 py-2 pl-2.5 text-left transition-all duration-150 active:translate-x-px active:opacity-70',
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
          'text-xs uppercase tracking-[0.6px] transition-colors duration-150',
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
  const navigate = useNavigate();
  const location = useLocation();

  const handleNewCanvas = async () => {
    const name = await repository.getUniqueFileName('Untitled Canvas', null);
    const id = await repository.createFile(name, 'mcanvas', null);
    navigate(`/mcanvas/${id}`);
  };

  return (
    <aside className="fixed top-0 bottom-0 left-0 z-20 flex w-64 flex-col bg-sidebar-bg p-6">
      {/* Brand */}
      <div className="flex flex-col gap-1 pb-4">
        <h2 className="font-heading text-text-brand text-xl italic">Myelin</h2>
        <span className="font-normal text-text-secondary text-xs uppercase tracking-[0.6px]">
          Digital Studio
        </span>
      </div>

      {/* New Canvas */}
      <button
        type="button"
        onClick={handleNewCanvas}
        className="group flex cursor-pointer items-center justify-center gap-2 rounded-md bg-gradient-to-b from-primary-container to-accent-dark px-4 py-2.5 transition-all duration-150 hover:brightness-125"
      >
        <Plus className="size-3.5 text-text-on-dark transition-transform duration-150 group-hover:rotate-90" />
        <span className="font-medium text-text-on-dark text-xs uppercase tracking-[0.6px]">
          New Canvas
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
