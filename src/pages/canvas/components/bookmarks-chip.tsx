import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Flag, Pencil, Trash2, X } from 'lucide-react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { BookmarkElement } from '@myelin/editor/elements/bookmark-element';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import { formatNumber } from '@myelin/editor/i18n/format';
import { cn } from '@myelin/editor/utils';
import { usePresence } from '@myelin/ui';

interface BookmarksChipProps {
  canvas: DrawableCanvas | null;
}

export function BookmarksChip({ canvas }: BookmarksChipProps) {
  const strings = useMessages();
  const locale = useLocale();
  const [flags, setFlags] = useState<BookmarkElement[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const presence = usePresence(open);

  useEffect(() => {
    if (!canvas) {
      setFlags([]);
      return;
    }
    setFlags(canvas.bookmarks);
    return canvas.onChange(() => setFlags(canvas.bookmarks));
  }, [canvas]);

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

  if (!canvas || flags.length === 0) {
    return null;
  }

  const labels = strings.canvas.bookmarks;
  const countLabel = formatNumber(flags.length, locale);
  const navButtonClass =
    'flex size-6 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover-tint hover:text-text-primary';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={labels.title}
        className={cn(
          'flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-surface px-2 text-text-secondary text-xs transition-colors',
          'hover:bg-surface hover:text-text-primary',
          open && 'bg-surface text-text-primary',
        )}
      >
        <Flag className="size-3.5" />
        <span className="font-medium tabular-nums">{countLabel}</span>
      </button>

      {presence.mounted && (
        <div
          {...presence.state}
          onAnimationEnd={presence.onAnimationEnd}
          role="dialog"
          aria-label={labels.title}
          className="data-closed:slide-out-to-top-1 data-closed:fade-out-0 data-open:slide-in-from-top-1 data-open:fade-in-0 absolute top-full right-0 z-[110] mt-2 flex max-h-[60vh] w-[20rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl bg-popover/95 shadow-ambient backdrop-blur-[24px] duration-[140ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] data-closed:animate-out data-open:animate-in"
        >
          <div className="flex items-center gap-1 px-3 pt-3 pb-2">
            <h2 className="m-0 flex-1 font-semibold text-[13px] text-text-primary">
              {labels.title}
            </h2>
            <button
              type="button"
              onClick={() => canvas.stepBookmark(-1)}
              aria-label={labels.previous}
              title={labels.previous}
              className={navButtonClass}
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => canvas.stepBookmark(1)}
              aria-label={labels.next}
              title={labels.next}
              className={navButtonClass}
            >
              <ChevronDown className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={strings.common.close}
              className={navButtonClass}
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {flags.map((flag) => (
              <BookmarkRow key={flag.uuid} canvas={canvas} flag={flag} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BookmarkRow({
  canvas,
  flag,
}: {
  canvas: DrawableCanvas;
  flag: BookmarkElement;
}) {
  const labels = useMessages().canvas.bookmarks;
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    const commit = () => {
      if (draft.trim() !== flag.label) {
        flag.setLabel(draft.trim());
      }
      setDraft(null);
    };
    return (
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft(null);
          }
        }}
        placeholder={labels.untitled}
        className="w-full rounded-md bg-surface px-2 py-1.5 text-text-primary text-xs outline-none"
      />
    );
  }

  const rowButtonClass =
    'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover-tint hover:text-text-primary';

  return (
    <div className="flex items-center gap-1 rounded-md transition-colors hover:bg-hover-tint">
      <button
        type="button"
        onClick={() => canvas.focusBookmark(flag.uuid)}
        className="min-w-0 flex-1 cursor-pointer truncate px-2 py-1.5 text-left text-text-secondary text-xs"
      >
        {flag.label || labels.untitled}
      </button>
      <button
        type="button"
        onClick={() => setDraft(flag.label)}
        aria-label={labels.rename}
        title={labels.rename}
        className={rowButtonClass}
      >
        <Pencil className="size-3" />
      </button>
      <button
        type="button"
        onClick={() => canvas.removeElement(flag)}
        aria-label={labels.remove}
        title={labels.remove}
        className={rowButtonClass}
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}
