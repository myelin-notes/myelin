import { useLayoutEffect, useRef } from 'react';
import { VirtualList } from '../../components/virtual-list';
import type {
  CodeRunResult,
  CodeRunSession,
} from '../../page-frame/pm/code-block/run-store';

/** Row height before measurement; corrected once each line mounts. */
const ESTIMATED_LINE_HEIGHT = 18;
/** Treat the body as "at the bottom" within this many px (tail-follow). */
const STICK_THRESHOLD = 4;

// Stable identities: the virtualizer keys its memoized layout off these, so fresh closures each
// render would force an O(line count) rebuild on every scroll frame.
const getLineRowKey = (index: number) => String(index);
const estimateLineHeight = () => ESTIMATED_LINE_HEIGHT;

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
}

/**
 * Card body for a {@link CodeOutputElement}. Renders the run session for its block; output is
 * in-memory only, so a card whose block hasn't run yet is empty. Pure props — the element pushes
 * store changes through render() imperatively (a useSyncExternalStore subscription inside this
 * flushSync-rendered root executed renders whose commits never reached the DOM). The header is
 * pointer-events: none so dragging it moves the element via the canvas; only the body (text
 * selection, scroll) and the stop button take pointer input.
 */
export function CodeOutputCardView({ session }: CodeOutputCardViewProps) {
  const running = session?.running === true;
  const lines = session?.lines ?? [];
  const result = session?.result ?? null;
  const dropped = session?.dropped ?? 0;

  const bodyRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Follow the tail as new lines arrive, unless the user scrolled up. Layout effect so a card
  // mounting with a finished run's output paints at the bottom rather than flashing the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when line count grows
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && stickToBottom.current) {
      body.scrollTop = body.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className="canvas-code-output__card">
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
        onWheel={(event) => {
          // Let ctrl+wheel (and trackpad pinch) reach the canvas so zoom still works over the output.
          if (!event.ctrlKey) {
            event.stopPropagation();
          }
        }}
        onScroll={() => {
          const body = bodyRef.current;
          if (body) {
            stickToBottom.current =
              body.scrollTop + body.clientHeight >=
              body.scrollHeight - STICK_THRESHOLD;
          }
        }}
      >
        {dropped > 0 ? (
          <div className="canvas-code-output__line is-stderr">
            … {dropped} earlier lines dropped
          </div>
        ) : null}
        {lines.length === 0 && !running ? (
          <div className="canvas-code-output__empty">No output</div>
        ) : (
          <VirtualList
            scrollRef={bodyRef}
            count={lines.length}
            estimateHeight={estimateLineHeight}
            getRowKey={getLineRowKey}
            gap={0}
            renderRow={(index) => {
              const line = lines[index];
              return (
                <div
                  className={
                    line.stream === 'stderr'
                      ? 'canvas-code-output__line is-stderr'
                      : 'canvas-code-output__line'
                  }
                >
                  {line.text === '' ? ' ' : line.text}
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
