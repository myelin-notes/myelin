import { cn } from '@/lib/utils';

export function ToggleRow({
  checked,
  onToggle,
  label,
  description,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-xl bg-input px-4 py-3 text-left ring-1 ring-border-subtle/70 transition-colors hover:bg-hover-tint"
    >
      <span className="min-w-0">
        <span className="block font-medium text-sm text-text-primary">
          {label}
        </span>
        <span className="mt-1 block text-text-muted text-xs leading-relaxed">
          {description}
        </span>
      </span>
      <span
        className={cn(
          'relative flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors',
          checked ? 'bg-accent-dark' : 'bg-text-muted/20',
        )}
      >
        <span
          className={cn(
            'size-4 rounded-full bg-card shadow-sm transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  );
}
