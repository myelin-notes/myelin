import { ArrowUpRight, Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@myelin/editor/utils';

export function ActionCard({
  icon: Icon,
  label,
  description,
  action,
  onClick,
  loading,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  action: string;
  onClick: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading}
      className="group flex w-full items-center gap-4 rounded-xl bg-input/40 px-4 py-3.5 text-left ring-1 ring-border-subtle/70 transition-colors duration-200 hover:bg-input disabled:pointer-events-none disabled:opacity-60"
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg bg-hover-tint text-text-secondary transition-colors duration-200',
          !disabled && 'group-hover:text-text-primary',
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-sm text-text-primary">
          {label}
        </span>
        <span className="mt-0.5 block text-text-muted text-xs leading-relaxed">
          {description}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-text-muted text-xs uppercase tracking-[0.08em] transition-colors duration-200 group-hover:text-text-brand">
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <>
            {action}
            <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </>
        )}
      </span>
    </button>
  );
}
