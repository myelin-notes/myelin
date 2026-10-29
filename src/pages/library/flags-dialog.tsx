import { useEffect, useState } from 'react';
import { Flag } from 'lucide-react';
import { resolveFlagType } from '@myelin/editor/elements/flag-element';
import { useFlagTypes } from '@myelin/editor/flag-types';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import { formatNumber } from '@myelin/editor/i18n/format';
import { Logger } from '@myelin/shared/logger';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { openNote } from '@/lib/note/navigation';
import { useRepository } from '@/lib/sync';
import type { NoteFlag } from '@/lib/sync/repo/types';
import { useTabController } from '@/lib/tabs/context';

const logger = new Logger('FlagsDialog');

interface FlagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
}

export function FlagsDialog({
  open,
  onOpenChange,
  folderId,
}: FlagsDialogProps) {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const tabController = useTabController();
  const { types } = useFlagTypes();
  const [flags, setFlags] = useState<NoteFlag[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setFlags(null);
    setFailed(false);
    repository
      .listFlags(folderId)
      .then((next) => {
        if (!cancelled) {
          setFlags(next);
        }
      })
      .catch((error) => {
        logger.error('Failed to list flags', error, { folderId });
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, folderId, repository]);

  const labels = strings.library.flagsDialog;
  const typeGroups = types
    .map((type) => {
      const notes = new Map<string, NoteFlag[]>();
      let count = 0;
      for (const flag of flags ?? []) {
        if (resolveFlagType(types, flag.flagTypeId) === type) {
          notes.set(flag.noteId, [...(notes.get(flag.noteId) ?? []), flag]);
          count++;
        }
      }
      const sortedNotes = [...notes.values()].sort((a, b) =>
        a[0].noteName.localeCompare(b[0].noteName),
      );
      return { type, count, notes: sortedNotes };
    })
    .filter((group) => group.count > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-xl">{labels.title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {failed && (
            <p className="m-0 text-destructive text-sm">{labels.loadFailed}</p>
          )}
          {flags?.length === 0 && (
            <p className="m-0 text-sm text-text-muted">{labels.empty}</p>
          )}
          {typeGroups.map(({ type, count, notes }) => (
            <section key={type.id} className="space-y-2">
              <h3 className="m-0 flex items-center gap-2 px-2 font-semibold text-sm text-text-primary">
                <Flag
                  className="size-3.5 shrink-0"
                  style={{ color: type.color }}
                />
                <span className="truncate">{type.name}</span>
                <span className="font-normal text-text-muted tabular-nums">
                  {formatNumber(count, locale)}
                </span>
              </h3>
              {notes.map((noteFlags) => (
                <div key={noteFlags[0].noteId}>
                  <h4 className="m-0 mb-1 truncate px-2 font-semibold text-[11px] text-text-muted uppercase tracking-[0.06em]">
                    {noteFlags[0].noteName}
                  </h4>
                  {noteFlags.map((flag) => (
                    <button
                      key={flag.id}
                      type="button"
                      onClick={() => {
                        onOpenChange(false);
                        openNote(
                          tabController,
                          {
                            fileType: 'mcanvas',
                            id: flag.noteId,
                            flagId: flag.id,
                          },
                          flag.noteName,
                        );
                      }}
                      className="flex w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-hover-tint hover:text-text-primary"
                    >
                      <span className="truncate">
                        {flag.label || strings.canvas.flags.untitled}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
