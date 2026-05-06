import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type {
  RenameReferencesChoice,
  RenameReferencesPrompt,
} from './use-explorer-item';

interface RenameReferencesDialogProps {
  prompt: RenameReferencesPrompt | null;
  onChoice: (choice: RenameReferencesChoice) => void;
}

export function RenameReferencesDialog({
  prompt,
  onChoice,
}: RenameReferencesDialogProps) {
  const strings = useMessages();
  const copy = strings.library.renameReferencesDialog;
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (prompt) {
      setRemember(false);
    }
  }, [prompt]);

  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open && prompt) {
          onChoice('no');
        }
      }}
    >
      {prompt && (
        <DialogContent className="sm:max-w-[420px]" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-xl">{copy.title}</DialogTitle>
            <DialogDescription>
              {copy.description(prompt.mentionCount, prompt.noteCount)}
            </DialogDescription>
          </DialogHeader>

          <button
            type="button"
            role="checkbox"
            aria-checked={remember}
            onClick={() => setRemember((v) => !v)}
            className="-mx-1 -my-0.5 flex cursor-pointer items-center gap-2.5 self-start rounded-md px-1 py-0.5 text-left text-sm text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span
              className={cn(
                'flex size-4 items-center justify-center rounded-sm transition-colors',
                remember
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-sidebar-bg',
              )}
            >
              {remember && <Check className="size-3" strokeWidth={3} />}
            </span>
            {copy.always}
          </button>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onChoice('no')}>
              {copy.no}
            </Button>
            <Button onClick={() => onChoice(remember ? 'always' : 'yes')}>
              {copy.yes}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
