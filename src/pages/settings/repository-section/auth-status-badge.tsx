import { Loader2 } from 'lucide-react';

export function AuthStatusBadge({
  hasToken,
  checking,
  polling,
}: {
  hasToken: boolean;
  checking: boolean;
  polling: boolean;
}) {
  if (checking) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] text-text-muted uppercase tracking-widest">
        <Loader2 className="size-3 animate-spin" />
        Checking
      </span>
    );
  }

  if (polling) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] text-text-muted uppercase tracking-widest">
        <Loader2 className="size-3 animate-spin" />
        Authorizing
      </span>
    );
  }

  if (hasToken) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-green/20 px-2.5 py-1 font-medium text-[10px] text-text-green uppercase tracking-widest">
        <span className="size-1.5 rounded-full bg-current" />
        Connected
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] text-text-muted uppercase tracking-widest">
      <span className="size-1.5 rounded-full bg-current" />
      Not connected
    </span>
  );
}
