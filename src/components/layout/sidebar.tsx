import { BookOpen, HelpCircle, Plus, Settings, Waypoints } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FileSystem } from '@/lib/utils/file-system';

interface NavItem {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
}

const mainNav: NavItem[] = [
  { label: 'Library', icon: <BookOpen className="size-4" />, active: true },
  { label: 'Graph', icon: <Waypoints className="size-5" /> },
];

const bottomNav: NavItem[] = [
  { label: 'Settings', icon: <Settings className="size-4" /> },
  { label: 'Help', icon: <HelpCircle className="size-4" /> },
];

export function Sidebar() {
  const navigate = useNavigate();

  const handleNewCanvas = async () => {
    const name = await FileSystem.getUniqueFileName('Untitled Canvas', null);
    const id = await FileSystem.createFile(name, 'mcanvas', null);
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
          {mainNav.map((item) => (
            <a
              key={item.label}
              href="#"
              className={cn(
                'group flex items-center gap-3 px-2 py-2 transition-all duration-150',
                item.active
                  ? 'border-accent-navy border-l-2 pl-2.5'
                  : 'border-transparent border-l-2 pl-2.5',
              )}
            >
              <span
                className={cn(
                  'transition-colors duration-150',
                  item.active
                    ? 'text-accent-navy'
                    : 'text-text-muted group-hover:text-text-secondary',
                )}
              >
                {item.icon}
              </span>
              <span
                className={cn(
                  'text-xs uppercase transition-colors duration-150',
                  item.active
                    ? 'font-semibold text-accent-navy tracking-[0.8px]'
                    : 'font-normal text-text-muted tracking-[0.6px] group-hover:text-text-primary',
                )}
              >
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
              className="group flex items-center gap-3 px-2 py-2 transition-all duration-150"
            >
              <span className="text-text-muted transition-colors duration-150 group-hover:text-text-secondary">
                {item.icon}
              </span>
              <span className="font-normal text-text-muted text-xs uppercase tracking-[0.6px] transition-colors duration-150 group-hover:text-text-primary">
                {item.label}
              </span>
            </a>
          ))}
        </div>
      </nav>
    </aside>
  );
}
