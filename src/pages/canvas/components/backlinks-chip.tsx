import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link2, X } from 'lucide-react';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import { formatNumber } from '@myelin/editor/i18n/format';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';
import { usePresence } from '@myelin/ui';
import {
  type NoteBacklink,
  useRepository,
  useRepositoryStatus,
  type VFSNodeId,
} from '@/lib/sync';

const logger = new Logger('BacklinksChip');

interface SnippetPart {
  text: string;
  highlighted: boolean;
}

interface BacklinksChipProps {
  noteId: VFSNodeId | undefined;
  onOpenSource: (sourceId: VFSNodeId) => void;
}

export function BacklinksChip({ noteId, onOpenSource }: BacklinksChipProps) {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const [backlinks, setBacklinks] = useState<NoteBacklink[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const loadBacklinks = useCallback(() => {
    if (!noteId) {
      setBacklinks([]);
      return;
    }

    let cancelled = false;
    repository
      .getBacklinks(noteId)
      .then((next) => {
        if (!cancelled) {
          setBacklinks(next);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        logger.error('Failed to load backlinks', error, { noteId });
        setBacklinks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [noteId, repository]);

  useEffect(() => loadBacklinks(), [loadBacklinks]);

  useEffect(() => {
    if (repositoryStatus.lastRemoteSyncAt !== null) {
      return loadBacklinks();
    }
  }, [loadBacklinks, repositoryStatus.lastRemoteSyncAt]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && containerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const rows = useMemo(() => sortBacklinks(backlinks), [backlinks]);
  const count = backlinks.length;
  const presence = usePresence(open);

  if (!noteId || count === 0) {
    return null;
  }

  const countLabel = formatNumber(count, locale);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={strings.canvas.backlinks.title}
        className={cn(
          'flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-surface px-2 text-text-secondary text-xs transition-colors',
          'hover:bg-surface hover:text-text-primary',
          open && 'bg-surface text-text-primary',
        )}
      >
        <Link2 className="size-3.5" />
        <span className="font-medium tabular-nums">{countLabel}</span>
      </button>

      {presence.mounted && (
        <div
          {...presence.state}
          onAnimationEnd={presence.onAnimationEnd}
          role="dialog"
          aria-label={strings.canvas.backlinks.title}
          className="data-closed:slide-out-to-top-1 data-closed:fade-out-0 data-open:slide-in-from-top-1 data-open:fade-in-0 absolute top-full left-0 z-[110] mt-2 flex max-h-[60vh] w-[22rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl bg-popover/95 shadow-ambient backdrop-blur-[24px] duration-[140ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] data-closed:animate-out data-open:animate-in"
        >
          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
            <h2 className="m-0 flex-1 font-semibold text-[13px] text-text-primary">
              {strings.canvas.backlinks.linkedMentions}
            </h2>
            <span className="rounded-md bg-surface px-1.5 py-0.5 font-medium text-[11px] text-text-secondary tabular-nums">
              {countLabel}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={strings.common.close}
              className="flex size-6 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover-tint hover:text-text-primary"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {rows.map((row, index) => (
              <BacklinkRow
                key={`${row.sourceId}\0${row.snippet}\0${index}`}
                row={row}
                onOpenSource={(sourceId) => {
                  setOpen(false);
                  onOpenSource(sourceId);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BacklinkRow({
  row,
  onOpenSource,
}: {
  row: NoteBacklink;
  onOpenSource: (sourceId: VFSNodeId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenSource(row.sourceId)}
      className="block w-full cursor-pointer rounded-md px-2 py-2 text-left transition-colors hover:bg-hover-tint"
    >
      <p className="m-0 text-text-secondary text-xs leading-5">
        <HighlightedSnippet snippet={row.snippet} title={row.title} />
      </p>
      <p className="m-0 mt-1.5 truncate text-[11px] text-text-muted italic">
        — {row.sourceName}
      </p>
    </button>
  );
}

function HighlightedSnippet({
  snippet,
  title,
}: {
  snippet: string;
  title: string;
}) {
  const parts = splitSnippet(snippet, title);

  return (
    <>
      {parts.map((part, index) => (
        <span
          key={`${part.text}\0${index}`}
          className={cn(
            part.highlighted &&
              'rounded-sm bg-secondary-container px-0.5 text-text-primary',
          )}
        >
          {part.text}
        </span>
      ))}
    </>
  );
}

function splitSnippet(snippet: string, title: string): SnippetPart[] {
  const target = title.trim();
  if (!target) {
    return [{ text: snippet, highlighted: false }];
  }

  const start = snippet.toLocaleLowerCase().indexOf(target.toLocaleLowerCase());
  if (start < 0) {
    return [{ text: snippet, highlighted: false }];
  }

  const end = start + target.length;
  return [
    { text: snippet.slice(0, start), highlighted: false },
    { text: snippet.slice(start, end), highlighted: true },
    { text: snippet.slice(end), highlighted: false },
  ].filter((part) => part.text.length > 0);
}

function sortBacklinks(backlinks: NoteBacklink[]): NoteBacklink[] {
  return [...backlinks].sort((a, b) => {
    const byName = a.sourceName.localeCompare(b.sourceName);
    if (byName !== 0) {
      return byName;
    }
    return a.snippet.localeCompare(b.snippet);
  });
}
