import { motion } from 'motion/react';
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
      aria-pressed={selected}
      className={cn(
        'group relative flex w-full cursor-pointer items-center gap-4 px-4 py-3.5 text-left transition-colors',
        selected
          ? 'bg-transparent'
          : 'bg-transparent hover:bg-hover-tint focus-visible:bg-hover-tint',
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
          selected
            ? 'bg-accent-navy/12 text-accent-navy'
            : 'bg-hover-tint text-text-secondary group-hover:text-text-primary',
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block font-heading text-[15px] leading-tight transition-colors',
            selected ? 'text-accent-navy' : 'text-text-primary',
          )}
        >
          {label}
        </span>
        <span className="mt-1 block text-text-muted text-xs leading-relaxed">
          {description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors',
          selected ? 'border-accent-navy' : 'border-border-divider',
        )}
      >
        <motion.span
          initial={false}
          animate={{ scale: selected ? 1 : 0, opacity: selected ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 480, damping: 32 }}
          className="size-[8px] rounded-full bg-accent-navy"
        />
      </span>
    </button>
  );
}
