import { useCallback, useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
import type { NoteSession, VFSNodeId } from '@/lib/sync';
import { useVersionStore, type VersionEntry } from '@/lib/sync';

const logger = new Logger('VersionHistoryDialog');

interface VersionHistoryDialogProps {
  noteId: VFSNodeId | undefined;
  noteSession: NoteSession | null;
  restoreVersion: (bytes: Uint8Array) => Promise<void>;
}

export function VersionHistoryDialog({
  noteId,
  noteSession,
  restoreVersion,
}: VersionHistoryDialogProps) {
  const strings = useMessages();
  const locale = useLocale();
  const versionStore = useVersionStore();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [confirmEntry, setConfirmEntry] = useState<VersionEntry | null>(null);
  const [restoring, setRestoring] = useState(false);
  const restoringRef = useRef(false);

  const versionHistoryStrings = strings.canvas.versionHistory;

  useEffect(() => {
    if (!open || !noteId) {
      return;
    }
    void versionStore.listVersions(noteId).then(setVersions);
  }, [open, noteId, versionStore]);

  const handleRestore = useCallback(
    async (entry: VersionEntry) => {
      if (!noteId || !noteSession || restoringRef.current) {
        return;
      }
      restoringRef.current = true;
      setRestoring(true);
      try {
        await versionStore.createSnapshot(
          noteId,
          noteSession.ydoc.encodeState(),
        );
        const bytes = await versionStore.getVersionBytes(
          noteId,
          entry.timestamp,
        );
        await restoreVersion(bytes);
        setOpen(false);
        setConfirmEntry(null);
      } catch (error) {
        logger.error('Failed to restore version', error, {
          noteId,
          timestamp: entry.timestamp,
        });
        toast.error(versionHistoryStrings.restoreFailed);
      } finally {
        restoringRef.current = false;
        setRestoring(false);
      }
    },
    [noteId, noteSession, restoreVersion, versionHistoryStrings, versionStore],
  );

  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        className="rounded-lg"
        onClick={() => setOpen(true)}
        aria-label={versionHistoryStrings.title}
        title={versionHistoryStrings.title}
      >
        <History className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[70vh] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="size-4 text-text-muted" />
              {versionHistoryStrings.title}
            </DialogTitle>
          </DialogHeader>
          {versions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <History className="size-8 text-text-muted/40" />
              <p className="font-heading text-muted-foreground text-sm italic">
                {versionHistoryStrings.empty}
              </p>
            </div>
          ) : (
            <div className="-mx-4 max-h-[calc(70vh-8rem)] overflow-y-auto px-4">
              <div className="space-y-0.5">
                {versions.map((entry) => (
                  <div
                    key={entry.timestamp}
                    className="group/version flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-hover-tint"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-text-primary">
                        {formatRelativeTime(entry.timestamp, locale)}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(entry.timestamp)}
                      </p>
                    </div>
                    <button
                      className="cursor-pointer font-medium text-primary text-xs underline-offset-3 opacity-0 transition-opacity hover:underline group-hover/version:opacity-100"
                      onClick={() => setConfirmEntry(entry)}
                    >
                      {versionHistoryStrings.restore}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmEntry !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setConfirmEntry(null);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <History />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {versionHistoryStrings.restoreConfirmTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {versionHistoryStrings.restoreConfirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring} className="rounded-lg">
              {versionHistoryStrings.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              className="rounded-lg"
              onClick={() => {
                if (confirmEntry) {
                  void handleRestore(confirmEntry);
                }
              }}
            >
              {versionHistoryStrings.restore}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
