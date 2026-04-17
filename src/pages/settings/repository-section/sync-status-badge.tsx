import { cn } from '@/lib/utils';

export type SyncStatusTone = 'neutral' | 'success' | 'danger';

export function SyncStatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: SyncStatusTone;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-[10px] uppercase tracking-widest',
        tone === 'success' && 'bg-accent-green/20 text-text-green',
        tone === 'danger' && 'bg-destructive/5 text-destructive',
        tone === 'neutral' && 'bg-hover-tint text-text-muted',
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
