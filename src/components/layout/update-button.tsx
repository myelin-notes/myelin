import { useCallback, useState } from 'react';
import { ArrowDownToLine, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMessages } from '@myelin/editor/i18n';
import { errorDescription } from '@/components/command-palette/utils';
import { installUpdate, useUpdate } from '@/lib/updater';

/**
 * Appears in the tab bar only while a newer release is waiting. Clicking it
 * downloads and installs the update, then relaunches into it; the label
 * doubles as the progress readout while that runs.
 */
export function UpdateButton() {
  const strings = useMessages();
  const update = useUpdate();
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const handleClick = useCallback(() => {
    if (!update) {
      return;
    }
    setInstalling(true);
    installUpdate(update, setProgress).catch((error) => {
      setInstalling(false);
      setProgress(null);
      toast.error(strings.updater.failed, {
        description: errorDescription(error),
      });
    });
  }, [strings.updater.failed, update]);

  if (!update) {
    return null;
  }

  const percent = progress === null ? null : Math.round(progress * 100);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={installing}
      title={strings.updater.available(update.version)}
      className="mr-2 flex h-6 shrink-0 cursor-pointer items-center gap-1 self-center rounded-md bg-accent-dark px-2 font-medium text-[11px] text-text-on-dark transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-75"
    >
      {installing ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <ArrowDownToLine className="size-3" />
      )}
      {installing
        ? percent === null
          ? `${strings.updater.installing}…`
          : `${strings.updater.installing} ${percent}%`
        : strings.updater.action}
    </button>
  );
}
