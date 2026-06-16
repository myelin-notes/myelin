import { type KeyboardEvent, useEffect, useRef } from 'react';
import {
  AudioLines,
  FileText,
  type LucideIcon,
  PenLine,
  Search,
  Type,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { SearchHighlight } from '@/pages/library/explorer/search-highlight';
import type { CanvasSearchKind } from '../search/collect';
import type { CanvasSearchController } from '../search/use-canvas-search';

const KIND_ICON: Record<CanvasSearchKind, LucideIcon> = {
  text: Type,
  'page-frame': FileText,
  transcript: AudioLines,
  handwriting: PenLine,
};

const SNIPPET_RADIUS = 80;

/** A window of `text` centered on the first matching term, with ellipses. */
function snippet(text: string, terms: readonly string[]): string {
  if (terms.length === 0 || text.length <= SNIPPET_RADIUS * 2) {
    return text;
  }
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) {
      at = found;
    }
  }
  if (at === -1) {
    return `${text.slice(0, SNIPPET_RADIUS * 2).trimEnd()}…`;
  }
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${
    end < text.length ? '…' : ''
  }`;
}

export function CanvasSearch({
  controller,
}: {
  controller: CanvasSearchController;
}) {
  const {
    open,
    query,
    setQuery,
    results,
    activeIndex,
    setActiveIndex,
    selectResult,
    close,
  } = controller;
  const strings = useMessages();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Keep the active row in view as it changes via the keyboard.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Close on a click outside the panel; the canvas stays live underneath.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(
        results.length === 0 ? 0 : (activeIndex + 1) % results.length,
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(
        results.length === 0
          ? 0
          : (activeIndex - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = results[activeIndex];
      if (item) {
        selectResult(item);
      }
    }
  };

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const showResults = query.trim().length > 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label={strings.canvas.search.placeholder}
          className="fixed top-[12vh] left-1/2 z-[200] flex w-[min(560px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-[1.2rem] bg-white/90 shadow-[0_24px_80px_rgba(25,28,30,0.16)] ring-1 ring-white/80 backdrop-blur-[28px]"
          initial={{ opacity: 0, y: -12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <Search className="size-4 shrink-0 text-text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={strings.canvas.search.placeholder}
              className="min-w-0 flex-1 bg-transparent py-1 font-normal text-base text-text-primary outline-none placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={close}
              aria-label={strings.common.clear}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {showResults && (
            <div
              ref={listRef}
              className="max-h-[46vh] overflow-y-auto border-border-divider border-t p-2"
            >
              {results.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-text-muted">
                  {strings.canvas.search.empty}
                </div>
              ) : (
                results.map((item, index) => {
                  const Icon = KIND_ICON[item.kind];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-index={index}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectResult(item)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                        index === activeIndex
                          ? 'bg-surface'
                          : 'hover:bg-surface/60',
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-text-muted" />
                      <span className="shrink-0 font-medium text-[11px] text-text-muted uppercase tracking-[0.04em]">
                        {strings.canvas.search.kinds[item.kind]}
                      </span>
                      <div className="min-w-0 flex-1 truncate text-sm text-text-primary">
                        <SearchHighlight
                          text={snippet(item.text, terms)}
                          terms={terms}
                        />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
