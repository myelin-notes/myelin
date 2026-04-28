import {
  type CSSProperties,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import type { EditorView } from 'prosemirror-view';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type {
  NoteLinkPreview,
  NoteLinkPreviewTarget,
} from '../../note-link-preview';
import { NoteLinkPreviewCard } from '../../note-link-preview-card';
import {
  getPageFrameAutocompleteAnchorRect,
  type PageFrameAutocompleteController,
  type PageFrameAutocompleteItem,
  type PageFrameAutocompleteState,
} from './index';

interface PageFrameAutocompletePopupProps {
  controller: PageFrameAutocompleteController | null;
  view: EditorView;
  onSelectItem?: (item: PageFrameAutocompleteItem) => void;
  loadingLabel?: string;
  emptyLabel?: string;
  errorLabel?: string;
  enablePreview?: boolean;
  loadPreview?: (
    target: NoteLinkPreviewTarget,
    signal: AbortSignal,
  ) => Promise<NoteLinkPreview | null>;
}

const EDGE_MARGIN = 12;
const ANCHOR_GAP = 8;
const LIST_WIDTH = 320;
const PREVIEW_WIDTH = 320;
const PREVIEW_DEBOUNCE_MS = 80;
// list + preview + viewport margins. Below this width we drop the side panel.
const PREVIEW_MIN_VIEWPORT_WIDTH =
  LIST_WIDTH + PREVIEW_WIDTH + EDGE_MARGIN * 2 + 32;

interface ActivePreviewState {
  itemId: string | null;
  body: string | null;
}

export function getAutocompleteScrollTop(
  container: Pick<HTMLElement, 'clientHeight' | 'scrollTop'>,
  item: Pick<HTMLElement, 'offsetHeight' | 'offsetTop'>,
): number {
  if (container.clientHeight <= 0) {
    return container.scrollTop;
  }

  const itemTop = item.offsetTop;
  const itemBottom = itemTop + item.offsetHeight;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;

  if (itemTop < viewTop) {
    return itemTop;
  }
  if (itemBottom > viewBottom) {
    return itemBottom - container.clientHeight;
  }
  return viewTop;
}

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
  enablePreview = false,
  loadPreview,
}: PageFrameAutocompletePopupProps) {
  const state = useAutocompleteState(controller);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  const activeItem =
    state.activeIndex >= 0 ? (state.items[state.activeIndex] ?? null) : null;
  const previewable =
    enablePreview && loadPreview !== undefined && state.items.length > 0;
  const previewVisible =
    previewable && window.innerWidth >= PREVIEW_MIN_VIEWPORT_WIDTH;

  const [activePreview, setActivePreview] = useState<ActivePreviewState>({
    itemId: null,
    body: null,
  });

  const loadPreviewEvent = useEffectEvent(
    async (target: NoteLinkPreviewTarget, signal: AbortSignal) => {
      return loadPreview ? loadPreview(target, signal) : null;
    },
  );

  useEffect(() => {
    if (!previewVisible || !activeItem) {
      setActivePreview({ itemId: null, body: null });
      return;
    }

    const itemId = activeItem.id;
    const itemTitle = activeItem.title;
    setActivePreview((prev) =>
      prev.itemId === itemId ? prev : { itemId, body: null },
    );

    const abortController = new AbortController();
    const timer = window.setTimeout(() => {
      void loadPreviewEvent(
        { noteId: itemId, title: itemTitle },
        abortController.signal,
      )
        .then((preview) => {
          if (abortController.signal.aborted) {
            return;
          }
          setActivePreview({
            itemId,
            body: preview?.body ?? null,
          });
        })
        .catch(() => {
          // Swallow — leave existing body as-is.
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      abortController.abort();
    };
  }, [activeItem?.id, previewVisible]);

  const open = state.open && state.anchorPosition !== null;
  const syncPosition = useEffectEvent(() => {
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
  });
  const handleDocumentPointerDown = useEffectEvent((event: PointerEvent) => {
    if (!(open && controller)) {
      return;
    }

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
  });

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
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      handleDocumentPointerDown(event);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

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

  useLayoutEffect(() => {
    if (!(open && state.activeIndex >= 0)) {
      return;
    }

    const list = listRef.current;
    const activeItem = list?.querySelector<HTMLElement>(
      '[data-autocomplete-active="true"]',
    );
    if (!(list && activeItem)) {
      return;
    }

    const nextScrollTop = getAutocompleteScrollTop(list, activeItem);
    if (nextScrollTop !== list.scrollTop) {
      list.scrollTop = nextScrollTop;
    }
  }, [open, state.activeIndex]);

  if (!(open && controller)) {
    return null;
  }

  return createPortal(
    <div
      ref={rootRef}
      data-page-frame-preserve-focus
      className="fade-in-0 zoom-in-95 fixed z-[52] flex animate-in items-stretch overflow-hidden rounded-2xl bg-popover/95 shadow-ambient backdrop-blur-2xl duration-100"
      style={{
        ...style,
        border: '0.5px solid var(--border-ghost)',
      }}
      onPointerDown={(event) => {
        event.preventDefault();
      }}
    >
      <div
        ref={listRef}
        role="listbox"
        aria-label="Autocomplete suggestions"
        className="flex max-h-[280px] w-[320px] flex-col gap-1 overflow-y-auto p-1.5"
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
              data-autocomplete-active={active ? 'true' : undefined}
              onPointerDown={(event) => {
                event.preventDefault();
              }}
              onMouseMove={() => {
                if (!active) {
                  controller.setActiveIndex(index);
                }
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
      {previewVisible && activeItem && (
        <div
          className="w-[320px] shrink-0"
          style={{
            borderLeft: '0.5px solid var(--border-ghost)',
          }}
        >
          <NoteLinkPreviewCard
            title={activeItem.title}
            body={
              activePreview.itemId === activeItem.id
                ? activePreview.body
                : null
            }
            noteId={activeItem.id}
          />
        </div>
      )}
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
