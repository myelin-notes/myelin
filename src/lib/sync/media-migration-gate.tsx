import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { Button } from '@myelin/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRepositoryStatus } from './repo-context';

export function RepositoryMediaMigrationGate() {
  const copy = useMessages().mediaMigration;
  const status = useRepositoryStatus();
  const [dismissed, setDismissed] = useState(false);
  const migration = status.mediaMigration;
  const open = Boolean(migration) && !dismissed;

  useEffect(() => {
    if (!open) {
      return;
    }
    // Focus stays in the dialog, but keybinds listen on window and document. Tab still reaches the
    // dialog's focus trap.
    const block = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', block, true);
    window.addEventListener('keyup', block, true);
    return () => {
      window.removeEventListener('keydown', block, true);
      window.removeEventListener('keyup', block, true);
    };
  }, [open]);

  if (!migration || dismissed) {
    return null;
  }

  // Signing back in happens behind this dialog, so a failed sync must never trap anyone here. The
  // migration carries on by itself once the repository is reachable.
  const stuck = !status.online || status.lastError !== null;

  return (
    <Dialog open modal>
      <DialogContent showCloseButton={false} className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2.5 text-text-secondary text-xs">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {migration.total === 0
            ? copy.preparing
            : migration.completed === migration.total
              ? copy.finishing
              : copy.progress(migration.completed, migration.total)}
        </div>
        {stuck && (
          <div className="grid gap-3">
            <p className="text-text-secondary text-xs">{copy.unreachable}</p>
            <Button variant="outline" onClick={() => setDismissed(true)}>
              {copy.continueWithoutWaiting}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
