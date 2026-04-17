import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function KindCard({
  selected,
  onSelect,
  icon: Icon,
  label,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group cursor-pointer text-left"
    >
      <div
        className={cn(
          'relative flex items-start gap-4 overflow-hidden rounded-xl p-5 transition-all duration-200',
          selected
            ? 'bg-white shadow-ambient ring-2 ring-accent-navy/20'
            : 'bg-input hover:bg-white hover:shadow-ambient',
        )}
      >
        {selected && (
          <div className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-accent-navy">
            <Check className="size-2.5 text-white" />
          </div>
        )}
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
            selected
              ? 'bg-accent-navy/10 text-accent-navy'
              : 'bg-hover-tint text-text-muted',
          )}
        >
          <Icon className="size-[18px]" />
        </div>
        <div className="min-w-0">
          <span
            className={cn(
              'block font-medium text-sm transition-colors',
              selected ? 'text-accent-navy' : 'text-text-primary',
            )}
          >
            {label}
          </span>
          <span className="mt-0.5 block text-text-muted text-xs leading-relaxed">
            {description}
          </span>
        </div>
      </div>
    </button>
  );
}
