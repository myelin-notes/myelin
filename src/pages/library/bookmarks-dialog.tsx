import { useEffect, useState } from 'react';
import { Flag } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { Logger } from '@myelin/shared/logger';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { openNote } from '@/lib/note/navigation';
import { useRepository } from '@/lib/sync';
import type { NoteBookmark } from '@/lib/sync/repo/types';
import { useTabController } from '@/lib/tabs/context';

const logger = new Logger('BookmarksDialog');

interface BookmarksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
}

export function BookmarksDialog({
  open,
  onOpenChange,
  folderId,
}: BookmarksDialogProps) {
  const strings = useMessages();
  const repository = useRepository();
  const tabController = useTabController();
  const [bookmarks, setBookmarks] = useState<NoteBookmark[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setBookmarks(null);
    setFailed(false);
    repository
      .listBookmarks(folderId)
      .then((next) => {
        if (!cancelled) {
          setBookmarks(next);
        }
      })
      .catch((error) => {
        logger.error('Failed to list bookmarks', error, { folderId });
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, folderId, repository]);

  const labels = strings.library.bookmarksDialog;
  const groups = new Map<string, NoteBookmark[]>();
  for (const bookmark of bookmarks ?? []) {
    groups.set(bookmark.noteId, [
      ...(groups.get(bookmark.noteId) ?? []),
      bookmark,
    ]);
  }
  const sortedGroups = [...groups.values()].sort((a, b) =>
    a[0].noteName.localeCompare(b[0].noteName),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-xl">{labels.title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {failed && (
            <p className="m-0 text-destructive text-sm">{labels.loadFailed}</p>
          )}
          {bookmarks?.length === 0 && (
            <p className="m-0 text-sm text-text-muted">{labels.empty}</p>
          )}
          {sortedGroups.map((group) => (
            <section key={group[0].noteId}>
              <h3 className="m-0 mb-1 truncate px-2 font-semibold text-[11px] text-text-muted uppercase tracking-[0.06em]">
                {group[0].noteName}
              </h3>
              {group.map((bookmark) => (
                <button
                  key={bookmark.id}
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    openNote(
                      tabController,
                      {
                        fileType: 'mcanvas',
                        id: bookmark.noteId,
                        bookmarkId: bookmark.id,
                      },
                      bookmark.noteName,
                    );
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-hover-tint hover:text-text-primary"
                >
                  <Flag className="size-3.5 shrink-0 text-[#ef4444]" />
                  <span className="truncate">
                    {bookmark.label || strings.canvas.bookmarks.untitled}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
