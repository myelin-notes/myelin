import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import type { EditorView } from 'prosemirror-view';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  getPageFrameAutocompleteAnchorRect,
  type PageFrameAutocompleteController,
  type PageFrameAutocompleteItem,
  type PageFrameAutocompleteState,
} from './autocomplete';

interface PageFrameAutocompletePopupProps {
  controller: PageFrameAutocompleteController | null;
  view: EditorView;
  onSelectItem?: (item: PageFrameAutocompleteItem) => void;
  loadingLabel?: string;
  emptyLabel?: string;
  errorLabel?: string;
}

const EDGE_MARGIN = 12;
const ANCHOR_GAP = 8;

function createClosedState(): PageFrameAutocompleteState {
  return {
    open: false,
    query: '',
    range: null,
    anchorPosition: null,
    items: [],
    activeIndex: -1,
    status: 'closed',
    error: null,
  };
}

function useAutocompleteState(
  controller: PageFrameAutocompleteController | null,
): PageFrameAutocompleteState {
  const [state, setState] = useState<PageFrameAutocompleteState>(
    () => controller?.getState() ?? createClosedState(),
  );

  useEffect(() => {
    if (!controller) {
      setState(createClosedState());
      return;
    }

    setState(controller.getState());
    return controller.subscribe(() => {
      setState(controller.getState());
    });
  }, [controller]);

  return state;
}

export function PageFrameAutocompletePopup({
  controller,
  view,
  onSelectItem,
  loadingLabel = 'Searching...',
  emptyLabel = 'No matches.',
  errorLabel = 'Could not load suggestions.',
}: PageFrameAutocompletePopupProps) {
  const state = useAutocompleteState(controller);
  const rootRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  const open = state.open && state.anchorPosition !== null;

  const syncPosition = useCallback(() => {
    if (!open || state.anchorPosition === null) {
      return;
    }

    const rect = getPageFrameAutocompleteAnchorRect(view, state.anchorPosition);
    const root = rootRef.current;
    if (!(rect && root)) {
      return;
    }

    const width = root.offsetWidth;
    const height = root.offsetHeight;

    let left = rect.left;
    left = Math.max(
      EDGE_MARGIN,
      Math.min(left, window.innerWidth - width - EDGE_MARGIN),
    );

    const below = rect.bottom + ANCHOR_GAP;
    const above = rect.top - height - ANCHOR_GAP;
    const top =
      below + height <= window.innerHeight - EDGE_MARGIN || above < EDGE_MARGIN
        ? Math.min(below, window.innerHeight - height - EDGE_MARGIN)
        : above;

    setStyle((current) => {
      if (current.left === left && current.top === top) {
        return current;
      }
      return { left, top };
    });
  }, [open, state.anchorPosition, view]);

  useEffect(() => {
    if (!open) {
      setStyle({});
      return;
    }

    let rafId = 0;
    const tick = () => {
      syncPosition();
      rafId = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [open, syncPosition]);

  useEffect(() => {
    if (!(open && controller)) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (rootRef.current?.contains(target)) {
        return;
      }
      if (view.dom.contains(target)) {
        return;
      }
      controller.close();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [controller, open, view]);

  useEffect(() => {
    const root = rootRef.current;
    if (!(open && root)) {
      return;
    }

    const stopPropagation = (event: PointerEvent) => {
      event.stopPropagation();
    };

    root.addEventListener('pointerdown', stopPropagation);
    return () => {
      root.removeEventListener('pointerdown', stopPropagation);
    };
  }, [open]);

  if (!(open && controller)) {
    return null;
  }

  return createPortal(
    <div
      ref={rootRef}
      data-page-frame-preserve-focus
      className="fade-in-0 zoom-in-95 fixed z-[52] w-[320px] animate-in overflow-hidden rounded-2xl bg-popover/95 p-1.5 shadow-ambient backdrop-blur-2xl duration-100"
      style={{
        ...style,
        border: '0.5px solid var(--border-ghost)',
      }}
      onPointerDown={(event) => {
        event.preventDefault();
      }}
    >
      <div
        role="listbox"
        aria-label="Autocomplete suggestions"
        className="flex max-h-[280px] flex-col gap-1 overflow-y-auto"
      >
        {state.status === 'loading' && (
          <AutocompleteStatusRow
            icon={<LoaderCircle className="size-4 animate-spin" />}
            label={loadingLabel}
          />
        )}
        {state.status === 'empty' && (
          <AutocompleteStatusRow
            icon={<FileText className="size-4" />}
            label={emptyLabel}
          />
        )}
        {state.status === 'error' && (
          <AutocompleteStatusRow
            icon={<FileText className="size-4" />}
            label={state.error?.message || errorLabel}
          />
        )}
        {state.items.map((item, index) => {
          const active = index === state.activeIndex;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={active}
              onPointerDown={(event) => {
                event.preventDefault();
              }}
              onMouseEnter={() => {
                controller.setActiveIndex(index);
              }}
              onClick={() => {
                const selected = controller.select(index);
                if (selected) {
                  onSelectItem?.(selected);
                }
                view.focus();
              }}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                active
                  ? 'bg-hover-tint text-text-primary'
                  : 'text-text-secondary hover:bg-hover-tint',
              )}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface/80 text-text-secondary">
                <FileText className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-sm text-text-primary">
                  {item.title}
                </div>
                {item.subtitle && (
                  <div className="truncate text-[11px] text-text-muted">
                    {item.subtitle}
                  </div>
                )}
              </div>
              {item.detail && (
                <span className="rounded-md bg-surface px-1.5 py-0.5 font-medium text-[10px] text-text-muted">
                  {item.detail}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

function AutocompleteStatusRow({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-text-muted">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface/80 text-text-secondary">
        {icon}
      </div>
      <span className="truncate">{label}</span>
    </div>
  );
}
