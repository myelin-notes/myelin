import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { NoteLinkPreviewCard } from './note-link-preview-card';
import type {
  NoteLinkPreview,
  NoteLinkPreviewTarget,
} from './note-link-preview';
import type { PageFrameAutocompleteController } from './pm/autocomplete';

const PREVIEW_WIDTH = 320;
const PREVIEW_MARGIN = 12;
const PREVIEW_GAP = 10;
const PREVIEW_ESTIMATED_HEIGHT = 256;
const HOVER_OPEN_DELAY_MS = 120;

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
  autocompleteController?: PageFrameAutocompleteController | null;
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

function targetKeyOf(target: NoteLinkPreviewTarget): string {
  return `${target.noteId ?? ''}\0${target.title}`;
}

export function NoteLinkPreviewPopover({
  getTargetAtPoint,
  loadPreview,
  autocompleteController,
}: NoteLinkPreviewPopoverProps) {
  const previewEnabled = loadPreview !== undefined;
  const [state, setState] = useState<NoteLinkPreviewState>({
    status: 'closed',
  });
  const activeTargetKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const getTargetAtPointEvent = useEffectEvent(getTargetAtPoint);
  const loadPreviewEvent = useEffectEvent(
    async (target: NoteLinkPreviewTarget, signal: AbortSignal) => {
      return loadPreview ? loadPreview(target, signal) : null;
    },
  );

  const closePreview = useEffectEvent(() => {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    activeTargetKeyRef.current = null;
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: 'closed' });
  });

  useEffect(() => {
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
      if (autocompleteController?.getState().open) {
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
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }

      // Hot-swap immediately when a preview is already on screen, so moving
      // between adjacent links feels instant. Cold-start gets a short delay
      // so a cursor sweep across links doesn't flash a bunch of previews.
      if (stateRef.current.status !== 'closed') {
        showPreview(hover);
        return;
      }

      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
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
  }, [previewEnabled, autocompleteController]);

  useEffect(() => {
    if (!autocompleteController) {
      return;
    }

    if (autocompleteController.getState().open) {
      closePreview();
    }

    return autocompleteController.subscribe(() => {
      if (autocompleteController.getState().open) {
        closePreview();
      }
    });
  }, [autocompleteController]);

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
      <NoteLinkPreviewCard title={title} body={body} noteId={noteId} />
    </div>
  );
}
