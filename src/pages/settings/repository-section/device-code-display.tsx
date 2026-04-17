import { useState } from 'react';
import { Check, ClipboardCopy } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';

export function DeviceCodeDisplay({
  userCode,
  onCopy,
}: {
  userCode: string;
  onCopy: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(userCode);
    setCopied(true);
    onCopy();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeInOut' }}
      className="overflow-hidden"
    >
      <div className="flex items-center justify-between rounded-xl bg-white px-5 py-4 shadow-ambient ring-1 ring-border-subtle">
        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-widest">
            Enter this code on GitHub
          </p>
          <p className="mt-1.5 font-mono font-semibold text-2xl text-accent-navy tracking-[0.25em]">
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
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </motion.div>
  );
}
