import { Loader2 } from 'lucide-react';
import { useStrings } from '@/lib/i18n';

export function AuthStatusBadge({
  hasToken,
  checking,
  polling,
}: {
  hasToken: boolean;
  checking: boolean;
  polling: boolean;
}) {
  const strings = useStrings();

  if (checking) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] text-text-muted uppercase tracking-widest">
        <Loader2 className="size-3 animate-spin" />
        {strings.settings.repository.authStatus.checking}
      </span>
    );
  }

  if (polling) {
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
        <span className="size-1.5 rounded-full bg-current" />
        {strings.settings.repository.authStatus.connected}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] text-text-muted uppercase tracking-widest">
      <span className="size-1.5 rounded-full bg-current" />
      {strings.settings.repository.authStatus.disconnected}
    </span>
  );
}
