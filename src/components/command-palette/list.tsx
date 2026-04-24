import { cn } from '@/lib/utils';
import type { CommandPaletteItem } from './types';

export function CommandPaletteList({
  items,
  activeIndex,
  onActiveIndexChange,
  onRunItem,
}: {
  items: CommandPaletteItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onRunItem: (item: CommandPaletteItem) => void;
}) {
  let previousSection = '';

  return (
    <div className="space-y-1">
      {items.map((item, index) => {
        const Icon = item.icon;
        const showSection = item.section !== previousSection;
        previousSection = item.section;

        return (
          <div key={item.id}>
            {showSection && (
              <div className="px-3 pt-2 pb-1 font-semibold text-[10px] text-text-muted uppercase tracking-[0.16em]">
                {item.section}
              </div>
            )}
            <button
              type="button"
              disabled={item.disabled}
              onMouseEnter={() => onActiveIndexChange(index)}
              onClick={() => onRunItem(item)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                index === activeIndex && 'bg-hover-tint',
                item.disabled
                  ? 'cursor-default opacity-50'
                  : 'cursor-pointer hover:bg-hover-tint',
              )}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-text-secondary">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-sm text-text-primary">
                  {item.label}
                </div>
                <div className="truncate text-[12px] text-text-muted">
                  {item.description}
                </div>
              </div>
              {item.shortcut && (
                <kbd className="rounded-md border border-border-divider bg-white px-1.5 py-0.5 font-semibold text-[10px] text-text-secondary">
                  {item.shortcut}
                </kbd>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
