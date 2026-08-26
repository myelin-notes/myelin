import { useEffect, useState } from 'react';
import { useMessages } from '@myelin/editor/i18n';
import { Button } from '@myelin/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
          onChoice('cancel');
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

          <label className="flex cursor-pointer select-none items-center gap-2.5 self-start text-sm text-text-secondary transition-colors hover:text-text-primary">
            <Checkbox
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked)}
            />
            {copy.always}
          </label>

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
