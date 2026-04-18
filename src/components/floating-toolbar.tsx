import { LayoutGrid, PenLine, RefreshCw, Shuffle } from 'lucide-react';
import { useStrings } from '@/lib/i18n';

interface ToolbarItem {
  icon: React.ReactNode;
  label: string;
}

export function FloatingToolbar() {
  const strings = useStrings();
  const mainTools: ToolbarItem[] = [
    {
      icon: <LayoutGrid className="size-5" />,
      label: strings.app.floatingToolbar.library,
    },
    {
      icon: <PenLine className="size-5" />,
      label: strings.app.floatingToolbar.write,
    },
    {
      icon: <Shuffle className="size-5" />,
      label: strings.app.floatingToolbar.shuffle,
    },
  ];

  return (
    <div className="fixed bottom-8 left-1/2 z-30 -translate-x-1/2">
      <div className="relative flex items-center gap-8 rounded-xl bg-primary px-6 py-3 shadow-ambient">
        {/* Main tools */}
        <div className="relative flex items-center gap-6">
          {mainTools.map((tool) => (
            <button
              key={tool.label}
              className="flex cursor-pointer flex-col items-center gap-0.5 text-white/60 transition-colors hover:text-white"
            >
              {tool.icon}
              <span className="font-bold text-[9px] uppercase tracking-[0.05em]">
                {tool.label}
              </span>
            </button>
          ))}
        </div>

        {/* Spacing instead of divider */}
        <div className="w-2" />

        {/* Cloud */}
        <button className="relative flex cursor-pointer flex-col items-center gap-0.5 text-white/60 transition-colors hover:text-white">
          <RefreshCw className="size-5" />
          <span className="font-bold text-[9px] uppercase tracking-[0.05em]">
            {strings.app.floatingToolbar.cloud}
          </span>
        </button>
      </div>
    </div>
  );
}
