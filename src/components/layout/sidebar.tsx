import {
  BookOpen,
  Waypoints,
  Settings,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  small?: boolean;
}

const mainNav: NavItem[] = [
  { label: "Library", icon: <BookOpen className="size-4" />, active: true },
  { label: "Graph", icon: <Waypoints className="size-5" /> },
];

const secondaryNav: NavItem[] = [
  { label: "Recently Opened", small: true },
  { label: "Favorites", small: true },
];

const bottomNav: NavItem[] = [
  { label: "Settings", icon: <Settings className="size-4" /> },
  { label: "Help", icon: <HelpCircle className="size-4" /> },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 bottom-0 z-20 flex w-64 flex-col bg-sidebar-bg p-6">
      {/* Brand */}
      <div className="flex flex-col gap-1 pb-4">
        <h2 className="font-heading text-xl italic text-text-brand">Myelin</h2>
        <span className="text-xs font-normal uppercase tracking-[0.6px] text-text-secondary">
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
                "flex items-center gap-3 px-2 py-2",
                item.active
                  ? "border-l-2 border-accent-navy pl-2.5"
                  : ""
              )}
            >
              <span className={cn(
                item.active ? "text-accent-navy" : "text-text-muted"
              )}>
                {item.icon}
              </span>
              <span
                className={cn(
                  "text-xs uppercase tracking-[0.6px]",
                  item.active
                    ? "font-semibold text-accent-navy"
                    : "font-normal text-text-muted"
                )}
              >
                {item.label}
              </span>
            </a>
          ))}
        </div>

        {/* Secondary Nav */}
        <div className="flex flex-col mt-2">
          {secondaryNav.map((item) => (
            <a
              key={item.label}
              href="#"
              className="flex items-center px-2 py-2"
            >
              <span className="text-[10px] font-normal uppercase tracking-[0.6px] text-text-muted">
                {item.label}
              </span>
            </a>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom Nav */}
        <div className="flex flex-col gap-2 pt-8">
          {bottomNav.map((item) => (
            <a
              key={item.label}
              href="#"
              className="flex items-center gap-3 p-2"
            >
              <span className="text-text-muted">{item.icon}</span>
              <span className="text-xs font-normal uppercase tracking-[0.6px] text-text-muted">
                {item.label}
              </span>
            </a>
          ))}
        </div>
      </nav>
    </aside>
  );
}
