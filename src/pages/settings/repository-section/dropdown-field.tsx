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
