import { BookOpen, HelpCircle, Settings, Waypoints } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  small?: boolean;
}

const mainNav: NavItem[] = [
  { label: 'Library', icon: <BookOpen className="size-4" />, active: true },
  { label: 'Graph', icon: <Waypoints className="size-5" /> },
];

const secondaryNav: NavItem[] = [
  { label: 'Recently Opened', small: true },
  { label: 'Favorites', small: true },
];

const bottomNav: NavItem[] = [
  { label: 'Settings', icon: <Settings className="size-4" /> },
  { label: 'Help', icon: <HelpCircle className="size-4" /> },
];

export function Sidebar() {
  return (
    <aside className="fixed top-0 bottom-0 left-0 z-20 flex w-64 flex-col bg-sidebar-bg p-6">
      {/* Brand */}
      <div className="flex flex-col gap-1 pb-4">
        <h2 className="font-heading text-text-brand text-xl italic">Myelin</h2>
        <span className="font-normal text-text-secondary text-xs uppercase tracking-[0.6px]">
          Digital Studio
        </span>
      </div>

      {/* Main Nav */}
      <nav className="flex flex-1 flex-col pt-4">
        <div className="flex flex-col">
          {mainNav.map((item) => (
            <a
              key={item.label}
              href="#"
              className={cn(
                'group flex items-center gap-3 px-2 py-2 transition-all duration-200',
                item.active
                  ? 'border-l-2 border-accent-navy pl-2.5'
                  : 'border-l-2 border-transparent pl-2.5',
              )}
            >
              <span
                className={cn(
                  'transition-colors duration-200',
                  item.active
                    ? 'text-accent-navy'
                    : 'text-text-muted group-hover:text-text-secondary',
                )}
              >
                {item.icon}
              </span>
              <span
                className={cn(
                  'text-xs uppercase transition-colors duration-200',
                  item.active
                    ? 'font-semibold tracking-[0.8px] text-accent-navy'
                    : 'font-normal tracking-[0.6px] text-text-muted group-hover:text-text-primary',
                )}
              >
                {item.label}
              </span>
            </a>
          ))}
        </div>

        {/* Secondary Nav */}
        <div className="mt-2 flex flex-col">
          {secondaryNav.map((item) => (
            <a
              key={item.label}
              href="#"
              className="group flex items-center px-2 py-2"
            >
              <span className="font-normal text-[10px] text-text-muted uppercase tracking-[0.6px] transition-colors duration-200 group-hover:text-text-secondary">
                {item.label}
              </span>
            </a>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom Nav */}
        <div className="flex flex-col pt-8">
          {bottomNav.map((item) => (
            <a
              key={item.label}
              href="#"
              className="group flex items-center gap-3 px-2 py-2 transition-all duration-200"
            >
              <span className="text-text-muted transition-colors duration-200 group-hover:text-text-secondary">
                {item.icon}
              </span>
              <span className="font-normal text-text-muted text-xs uppercase tracking-[0.6px] transition-colors duration-200 group-hover:text-text-primary">
                {item.label}
              </span>
            </a>
          ))}
        </div>
      </nav>
    </aside>
  );
}
