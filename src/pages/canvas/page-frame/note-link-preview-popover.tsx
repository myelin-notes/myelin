import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useThumbnailUrl } from '@/lib/use-thumbnail-url';
import { cn } from '@/lib/utils';
import type {
  NoteLinkPreview,
  NoteLinkPreviewTarget,
} from './note-link-preview';

const PREVIEW_WIDTH = 320;
const PREVIEW_MARGIN = 12;
const PREVIEW_GAP = 10;
const PREVIEW_ESTIMATED_HEIGHT = 256;
const HOVER_OPEN_DELAY_MS = 120;

const DOT_PLACEHOLDER_STYLE = {
  backgroundImage:
    'linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0) 48%), radial-gradient(circle, rgba(28, 39, 56, 0.12) 1px, transparent 1px)',
  backgroundPosition: '0 0, 0 0',
  backgroundSize: '100% 100%, 14px 14px',
};

const FADE_MASK = 'linear-gradient(to bottom, black 76%, transparent 100%)';

export interface NoteLinkPreviewHit {
  target: NoteLinkPreviewTarget;
  rect: DOMRect;
}

interface PopoverPosition {
  left: number;
  top: number;
  flipped: boolean;
}

type NoteLinkPreviewState =
  | { status: 'closed' }
  | {
      status: 'loading';
      title: string;
      position: PopoverPosition;
    }
  | {
      status: 'ready';
      preview: NoteLinkPreview;
      position: PopoverPosition;
    };

interface NoteLinkPreviewPopoverProps {
  getTargetAtPoint: (
    clientX: number,
    clientY: number,
  ) => NoteLinkPreviewHit | null;
  loadPreview?: (
    target: NoteLinkPreviewTarget,
    signal: AbortSignal,
  ) => Promise<NoteLinkPreview | null>;
}

function computePosition(rect: DOMRect): PopoverPosition {
  const left = Math.max(
    PREVIEW_MARGIN,
    Math.min(rect.left, window.innerWidth - PREVIEW_WIDTH - PREVIEW_MARGIN),
  );

  const spaceBelow = window.innerHeight - rect.bottom - PREVIEW_GAP;
  const spaceAbove = rect.top - PREVIEW_GAP;
  const flipped =
    spaceBelow < PREVIEW_ESTIMATED_HEIGHT + PREVIEW_MARGIN &&
    spaceAbove > spaceBelow;

  const top = flipped
    ? Math.max(
        PREVIEW_MARGIN,
        rect.top - PREVIEW_ESTIMATED_HEIGHT - PREVIEW_GAP,
      )
    : Math.min(
        window.innerHeight - PREVIEW_ESTIMATED_HEIGHT - PREVIEW_MARGIN,
        rect.bottom + PREVIEW_GAP,
      );

  return { left, top, flipped };
}

function isAutocompleteOpen(): boolean {
  return (
    document.querySelector(
      '[role="listbox"][aria-label="Autocomplete suggestions"]',
    ) !== null
  );
}

function targetKeyOf(target: NoteLinkPreviewTarget): string {
  return `${target.noteId ?? ''}\0${target.title}`;
}

export function NoteLinkPreviewPopover({
  getTargetAtPoint,
  loadPreview,
}: NoteLinkPreviewPopoverProps) {
  const previewEnabled = loadPreview !== undefined;
  const [state, setState] = useState<NoteLinkPreviewState>({
    status: 'closed',
  });
  const activeTargetKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const getTargetAtPointEvent = useEffectEvent(getTargetAtPoint);
  const loadPreviewEvent = useEffectEvent(
    async (target: NoteLinkPreviewTarget, signal: AbortSignal) => {
      return loadPreview ? loadPreview(target, signal) : null;
    },
  );

  useEffect(() => {
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelPending = () => {
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    };

    const closePreview = () => {
      cancelPending();
      activeTargetKeyRef.current = null;
      requestIdRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setState({ status: 'closed' });
    };

    if (!previewEnabled) {
      closePreview();
      return;
    }

    const showPreview = (hover: NoteLinkPreviewHit) => {
      activeTargetKeyRef.current = targetKeyOf(hover.target);
      requestIdRef.current += 1;
      abortRef.current?.abort();

      const requestId = requestIdRef.current;
      const abortController = new AbortController();
      abortRef.current = abortController;
      const position = computePosition(hover.rect);

      setState({
        status: 'loading',
        title: hover.target.title,
        position,
      });

      void loadPreviewEvent(hover.target, abortController.signal)
        .then((preview) => {
          if (
            requestIdRef.current !== requestId ||
            abortController.signal.aborted
          ) {
            return;
          }

          if (!preview) {
            closePreview();
            return;
          }

          setState({
            status: 'ready',
            preview,
            position,
          });
        })
        .catch(() => {
          if (requestIdRef.current === requestId) {
            closePreview();
          }
        });
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (isAutocompleteOpen()) {
        closePreview();
        return;
      }

      const hover = getTargetAtPointEvent(event.clientX, event.clientY);
      if (!hover) {
        closePreview();
        return;
      }

      const targetKey = targetKeyOf(hover.target);
      if (activeTargetKeyRef.current === targetKey) {
        return;
      }

      activeTargetKeyRef.current = targetKey;
      cancelPending();

      // Hot-swap immediately when a preview is already on screen, so moving
      // between adjacent links feels instant. Cold-start gets a short delay
      // so a cursor sweep across links doesn't flash a bunch of previews.
      if (stateRef.current.status !== 'closed') {
        showPreview(hover);
        return;
      }

      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        showPreview(hover);
      }, HOVER_OPEN_DELAY_MS);
    };

    const handlePointerLeave = () => {
      closePreview();
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      closePreview();
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [previewEnabled]);

  if (state.status === 'closed') {
    return null;
  }

  const title = state.status === 'ready' ? state.preview.title : state.title;
  const noteId = state.status === 'ready' ? state.preview.noteId : null;
  const body = state.status === 'ready' ? state.preview.body : null;

  return (
    <div
      data-page-frame-preserve-focus
      className={cn(
        'pointer-events-none fixed z-[80] w-[320px] overflow-hidden rounded-2xl bg-popover/95 shadow-ambient backdrop-blur-2xl',
        'fade-in-0 animate-in duration-150',
        state.position.flipped
          ? 'slide-in-from-bottom-1'
          : 'slide-in-from-top-1',
      )}
      style={{
        left: state.position.left,
        top: state.position.top,
        border: '0.5px solid var(--border-ghost, rgba(195, 199, 202, 0.3))',
      }}
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="truncate font-heading font-normal text-[17px] text-text-primary leading-6 tracking-[-0.005em]">
          {title}
        </div>
      </div>
      <ThumbnailRegion noteId={noteId} body={body} />
    </div>
  );
}

function ThumbnailRegion({
  noteId,
  body,
}: {
  noteId: string | null;
  body: string | null;
}) {
  return (
    <div
      className="relative aspect-[16/10] w-full overflow-hidden bg-surface/80"
      style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
    >
      <div
        className="absolute inset-0 opacity-90"
        style={DOT_PLACEHOLDER_STYLE}
      />
      {noteId ? (
        <ThumbnailImage noteId={noteId} body={body} />
      ) : (
        <ExcerptOverlay body={body} />
      )}
    </div>
  );
}

function ThumbnailImage({
  noteId,
  body,
}: {
  noteId: string;
  body: string | null;
}) {
  const thumbUrl = useThumbnailUrl(noteId);
  const [imgLoaded, setImgLoaded] = useState(false);
  const hasThumb = typeof thumbUrl === 'string';

  if (!hasThumb) {
    return <ExcerptOverlay body={body} />;
  }

  return (
    <img
      src={thumbUrl}
      alt=""
      aria-hidden
      onLoad={() => setImgLoaded(true)}
      className={cn(
        'relative h-full w-full object-cover object-top transition-opacity duration-300 ease-out',
        imgLoaded ? 'opacity-100' : 'opacity-0',
      )}
    />
  );
}

function ExcerptOverlay({ body }: { body: string | null }) {
  if (!body) {
    return null;
  }
  return (
    <div className="absolute inset-0 flex items-start px-4 pt-3">
      <p className="line-clamp-5 whitespace-pre-wrap text-[12px] text-text-secondary leading-5">
        {body}
      </p>
    </div>
  );
}
