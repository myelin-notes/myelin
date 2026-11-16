import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { VirtualList } from '../../components/virtual-list';
import type {
  CodeRunResult,
  CodeRunSession,
} from '../../page-frame/pm/code-block/run-store';
import { FRAME_FIT_WIDTH, OutputItemView } from './output-item';

/** Row height before measurement; corrected once each item mounts. */
const ESTIMATED_LINE_HEIGHT = 18;
/** Treat the body as "at the bottom" within this many px (tail-follow). */
const STICK_THRESHOLD = 4;

// Stable identities: the virtualizer keys its memoized layout off these, so fresh closures each
// render would force an O(line count) rebuild on every scroll frame.
const getLineRowKey = (index: number) => String(index);
const estimateLineHeight = () => ESTIMATED_LINE_HEIGHT;

/** Card size (world px) that shows all content without scrolling. */
export interface CardFitSize {
  width: number;
  height: number;
}

// Widest fixed-width rich item; text wraps to whatever width the card has, so it contributes 0.
function naturalContentWidth(content: HTMLElement): number {
  let width = 0;
  for (const el of content.querySelectorAll<HTMLElement>(
    '.canvas-code-output__table-wrap, .canvas-code-output__image, .canvas-code-output__frame',
  )) {
    if (el instanceof HTMLImageElement) {
      width = Math.max(width, parseFloat(el.style.width) || el.naturalWidth);
    } else if (el instanceof HTMLIFrameElement) {
      width = Math.max(width, FRAME_FIT_WIDTH);
    } else {
      // The wrap is width-constrained; its table child keeps its natural width.
      width = Math.max(width, el.scrollWidth + el.offsetWidth - el.clientWidth);
    }
  }
  return width;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function statusText(result: CodeRunResult): string {
  if (result.cancelled) {
    return 'Stopped';
  }
  if (result.error) {
    return 'Failed';
  }
  if (result.exitCode !== 0) {
    return `Exit ${result.exitCode}`;
  }
  return `Done in ${formatDuration(result.durationMs)}`;
}

interface CodeOutputCardViewProps {
  /** Run session for this block, or null if it hasn't run in this app session. */
  session: CodeRunSession | null;
  /** Forwards a ctrl+wheel event to the viewport; see the wheel effect below. */
  onZoomWheel: (event: WheelEvent) => void;
  /** Reports the size that fits the content whenever it changes. */
  onFitSize: (size: CardFitSize) => void;
}

/**
 * Card body for a {@link CodeOutputElement}. Renders the run session for its block; output is
 * in-memory only, so a card whose block hasn't run yet is empty. Pure props — the element pushes
 * store changes through render() imperatively (a useSyncExternalStore subscription inside this
 * flushSync-rendered root executed renders whose commits never reached the DOM). The header is
 * pointer-events: none so dragging it moves the element via the canvas; only the body (text
 * selection, scroll) and the stop button take pointer input.
 */
export function CodeOutputCardView({
  session,
  onZoomWheel,
  onFitSize,
}: CodeOutputCardViewProps) {
  const running = session?.running === true;
  const items = session?.items ?? [];
  const result = session?.result ?? null;
  const dropped = session?.dropped ?? 0;

  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const reportFitSize = useEffectEvent(() => {
    const card = cardRef.current;
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!card || !body || !content) {
      return;
    }
    const style = getComputedStyle(body);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    // offset* sizes ignore the card's zoom transform, so these are world px.
    onFitSize({
      // Card borders + any vertical scrollbar.
      width:
        naturalContentWidth(content) +
        padX +
        card.offsetWidth -
        body.clientWidth,
      // Header + card borders.
      height:
        content.offsetHeight + padY + card.offsetHeight - body.offsetHeight,
    });
  });

  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    const observer = new ResizeObserver(() => reportFitSize());
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // A finished run may leave the content size unchanged but lift the grow-only rule mid-run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-fit when the run state flips
  useLayoutEffect(() => {
    reportFitSize();
  }, [running]);

  // Follow the tail as new items arrive, unless the user scrolled up. Layout effect so a card
  // mounting with a finished run's output paints at the bottom rather than flashing the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when item count grows
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && stickToBottom.current) {
      body.scrollTop = body.scrollHeight;
    }
  }, [items.length]);

  // The card mounts in the frame chrome layer, outside the subtree the viewport listens on, so
  // ctrl+wheel zoom has to be handed to it explicitly. Native and non-passive because React's own
  // onWheel is passive, which would leave the browser free to page-zoom on top of the canvas zoom.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.stopPropagation();
      if (event.ctrlKey) {
        onZoomWheel(event);
      }
    };
    body.addEventListener('wheel', handleWheel, { passive: false });
    return () => body.removeEventListener('wheel', handleWheel);
  }, [onZoomWheel]);

  return (
    <div ref={cardRef} className="canvas-code-output__card">
      <div className="canvas-code-output__header">
        <span className="canvas-code-output__lang">
          {session?.language ?? ''}
        </span>
        <span
          className={
            running
              ? 'canvas-code-output__status is-running'
              : 'canvas-code-output__status'
          }
        >
          {running ? 'Running' : result ? statusText(result) : ''}
        </span>
        {running && session ? (
          <button
            type="button"
            className="canvas-code-output__stop"
            aria-label="Stop"
            onClick={() => session.stop()}
          >
            ■
          </button>
        ) : null}
      </div>
      <div
        ref={bodyRef}
        className="canvas-code-output__body"
        onScroll={() => {
          const body = bodyRef.current;
          if (body) {
            stickToBottom.current =
              body.scrollTop + body.clientHeight >=
              body.scrollHeight - STICK_THRESHOLD;
          }
        }}
      >
        <div ref={contentRef}>
          {dropped > 0 ? (
            <div className="canvas-code-output__line is-stderr">
              … {dropped} earlier lines dropped
            </div>
          ) : null}
          {items.length === 0 && !running ? (
            <div className="canvas-code-output__empty">No output</div>
          ) : (
            <VirtualList
              scrollRef={bodyRef}
              count={items.length}
              estimateHeight={estimateLineHeight}
              getRowKey={getLineRowKey}
              gap={0}
              renderRow={(index) => <OutputItemView item={items[index]} />}
            />
          )}
        </div>
      </div>
    </div>
  );
}
