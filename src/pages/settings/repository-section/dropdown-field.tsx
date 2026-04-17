import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const FIELD_TRIGGER_CLASS =
  'group flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-lg bg-transparent px-2.5 text-left text-sm text-text-primary outline-none transition-colors hover:bg-white aria-expanded:bg-white disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:opacity-60';

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[10px] text-text-muted uppercase tracking-widest">
      {children}
    </label>
  );
}

export function MenuLoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-text-muted">
      <Loader2 className="size-3.5 shrink-0 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function MenuEmptyRow({ label }: { label: string }) {
  return <div className="px-2.5 py-2 text-sm text-text-muted">{label}</div>;
}

export function Avatar({
  src,
  fallback,
  className,
}: {
  src: string | null | undefined;
  fallback: React.ReactNode;
  className?: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn('size-5 shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full bg-hover-tint text-text-muted',
        className,
      )}
    >
      {fallback}
    </span>
  );
}
