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
      <div className="relative flex items-center gap-8 rounded-xl bg-primary px-6 py-3 shadow-ambient">
        {/* Main tools */}
        <div className="relative flex items-center gap-6">
          {mainTools.map((tool) => (
            <button
              key={tool.label}
              className="flex flex-col items-center gap-0.5 text-white/60 hover:text-white transition-colors cursor-pointer"
            >
              {tool.icon}
              <span className="text-[9px] font-bold uppercase tracking-[0.05em]">
                {tool.label}
              </span>
            </button>
          ))}
        </div>

        {/* Spacing instead of divider */}
        <div className="w-2" />

        {/* Cloud */}
        <button className="relative flex flex-col items-center gap-0.5 text-white/60 hover:text-white transition-colors cursor-pointer">
          <RefreshCw className="size-5" />
          <span className="text-[9px] font-bold uppercase tracking-[0.05em]">
            Cloud
          </span>
        </button>
      </div>
    </div>
  );
}
