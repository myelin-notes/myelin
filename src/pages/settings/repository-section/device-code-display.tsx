import { useState } from 'react';
import { Check, ClipboardCopy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useResettableTimeout } from '@/hooks/use-resettable-timeout';
import { useMessages } from '@/lib/i18n';

export function DeviceCodeDisplay({ userCode }: { userCode: string }) {
  const strings = useMessages();
  const [copied, setCopied] = useState(false);
  const copiedReset = useResettableTimeout();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(userCode);
    setCopied(true);
    copiedReset.schedule(() => setCopied(false), 2000);
  };

  return (
    <div className="fade-in-0 animate-in duration-150">
      <div className="flex items-center justify-between rounded-xl bg-card px-5 py-4 shadow-ambient ring-1 ring-border-subtle/70">
        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-widest">
            {strings.settings.repository.auth.deviceCode}
          </p>
          <p className="mt-1.5 font-mono font-semibold text-2xl text-text-brand tracking-[0.25em]">
            {userCode}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleCopy()}
          className="shrink-0"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <ClipboardCopy className="size-3.5" />
          )}
          {copied ? strings.common.copied : strings.common.copy}
        </Button>
      </div>
    </div>
  );
}
