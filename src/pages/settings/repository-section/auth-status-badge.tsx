import { Check, Circle, Loader2 } from 'lucide-react';
import { useMessages } from '@/lib/i18n';

export function AuthStatusBadge({
  hasToken,
  checking,
  authorizing,
}: {
  hasToken: boolean;
  checking: boolean;
  authorizing: boolean;
}) {
  const strings = useMessages();

  if (checking) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] text-text-muted uppercase tracking-widest">
        <Loader2 className="size-3 animate-spin" />
        {strings.settings.repository.authStatus.checking}
      </span>
    );
  }

  if (authorizing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] text-text-muted uppercase tracking-widest">
        <Loader2 className="size-3 animate-spin" />
        {strings.settings.repository.authStatus.authorizing}
      </span>
    );
  }

  if (hasToken) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-green/20 px-2.5 py-1 font-medium text-[10px] text-text-green uppercase tracking-widest">
        <Check className="size-3 text-current" />
        {strings.settings.repository.authStatus.connected}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] text-text-muted uppercase tracking-widest">
      <Circle className="size-3 text-current" />
      {strings.settings.repository.authStatus.disconnected}
    </span>
  );
}
