import { type KeyboardEvent, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { usePresence } from '@myelin/ui';
import { useMessages } from '@/lib/i18n';
import type { CanvasSearchController } from '../search/use-canvas-search';

export function CanvasSearch({
  controller,
}: {
  controller: CanvasSearchController;
}) {
  const { open, query, setQuery, total, current, settled, next, prev, close } =
    controller;
  const strings = useMessages();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  // Close on a click outside the bar; the canvas stays live underneath.
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
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        prev();
      } else {
        next();
      }
    }
  };

  const hasQuery = query.trim().length > 0;
  // While the debounce is in flight the counter reflects the previous query, so
  // suppress it until the typed query has actually been matched — otherwise a
  // fresh keystroke briefly flashes a stale "No results".
  const counter =
    !hasQuery || !settled
      ? ''
      : total === 0
        ? strings.canvas.search.noResults
        : `${current}/${total}`;
  const noMatches = hasQuery && settled && total === 0;
  const presence = usePresence(open);

  if (!presence.mounted) {
    return null;
  }

  return (
    <div
      {...presence.state}
      onAnimationEnd={presence.onAnimationEnd}
      ref={panelRef}
      role="dialog"
      aria-label={strings.canvas.search.placeholder}
      className="data-closed:slide-out-to-top-2 data-closed:fade-out-0 data-open:slide-in-from-top-2 data-open:fade-in-0 fixed top-[max(1rem,env(safe-area-inset-top))] right-4 z-[200] flex items-center gap-1 rounded-xl bg-popover/90 py-1.5 pr-1.5 pl-2 shadow-[0_12px_40px_rgb(var(--shadow-rgb)/0.16)] ring-1 ring-border-subtle backdrop-blur-[28px] duration-[140ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] data-closed:animate-out data-open:animate-in"
    >
      <Search className="ml-1 size-4 shrink-0 text-text-muted" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={strings.canvas.search.placeholder}
        className="w-44 min-w-0 bg-transparent px-1 py-0.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
      />
      <span
        className={`min-w-[3.25rem] shrink-0 text-right text-xs tabular-nums ${
          noMatches ? 'text-destructive' : 'text-text-muted'
        }`}
      >
        {counter}
      </span>
      <button
        type="button"
        onClick={prev}
        disabled={total === 0}
        aria-label={strings.canvas.search.previous}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface hover:text-text-primary disabled:opacity-40"
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        onClick={next}
        disabled={total === 0}
        aria-label={strings.canvas.search.next}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface hover:text-text-primary disabled:opacity-40"
      >
        <ChevronDown className="size-4" />
      </button>
      <button
        type="button"
        onClick={close}
        aria-label={strings.common.clear}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
