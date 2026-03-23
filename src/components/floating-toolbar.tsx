import {
  LayoutGrid,
  PenLine,
  Shuffle,
  RefreshCw,
} from "lucide-react";

interface ToolbarItem {
  icon: React.ReactNode;
  label: string;
}

const mainTools: ToolbarItem[] = [
  { icon: <LayoutGrid className="size-5" />, label: "Library" },
  { icon: <PenLine className="size-5" />, label: "Write" },
  { icon: <Shuffle className="size-5" />, label: "Shuffle" },
];

export function FloatingToolbar() {
  return (
    <div className="fixed bottom-8 left-1/2 z-30 -translate-x-1/2">
      <div className="relative flex items-center gap-8 rounded-xl bg-toolbar px-6 py-3 backdrop-blur-[12px]">
        {/* Shadow layer */}
        <div className="pointer-events-none absolute inset-0 rounded-xl shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)]" />

        {/* Main tools */}
        <div className="relative flex items-center gap-6">
          {mainTools.map((tool) => (
            <button
              key={tool.label}
              className="flex flex-col items-center gap-0.5 text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              {tool.icon}
              <span className="text-[9px] font-bold uppercase tracking-[-0.45px]">
                {tool.label}
              </span>
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="relative h-6 w-px bg-border-divider opacity-30" />

        {/* Cloud */}
        <button className="relative flex flex-col items-center gap-0.5 text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
          <RefreshCw className="size-5" />
          <span className="text-[9px] font-bold uppercase tracking-[-0.45px]">
            Cloud
          </span>
        </button>
      </div>
    </div>
  );
}
