import {
  type CSSProperties,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { EditorView } from 'prosemirror-view';
import { createPortal } from 'react-dom';
import { VirtualList } from '../../../components/virtual-list';
import { PM_EDITOR_CLASS } from '../constants';
import { getPageFramePmScreenRectForElement } from '../screen-rect';
import { type CodeRunEntry, codeRunStore } from './run-store';

const ANCHOR_GAP = 12;
const EDGE_MARGIN = 12;
/** Row height before measurement; corrected once each line mounts. */
const ESTIMATED_LINE_HEIGHT = 18;
/** Treat the body as "at the bottom" within this many px (tail-follow). */
const STICK_THRESHOLD = 4;

// Stable identities: the virtualizer keys its memoized layout off these, so fresh closures each
// render would force an O(line count) rebuild on every scroll frame.
const getLineRowKey = (index: number) => String(index);
const estimateLineHeight = () => ESTIMATED_LINE_HEIGHT;

/**
 * Floating output overlay for every active code run, anchored to each block in screen space and
 * tracked through canvas pan/zoom via a rAF loop. Output lines are windowed with
 * {@link VirtualList}. Mounted once in the page-frame DOM layer.
 */
export function CodeRunOverlayLayer() {
  const entries = useSyncExternalStore(
    codeRunStore.subscribe,
    codeRunStore.getSnapshot,
  );
  const visible = entries.filter((entry) => entry.visible);
  if (visible.length === 0) {
    return null;
  }

  return createPortal(
    visible.map((entry) => <CodeRunOverlay key={entry.id} entry={entry} />),
    document.body,
  );
}

function CodeRunOverlay({ entry }: { entry: CodeRunEntry }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [style, setStyle] = useState<CSSProperties>({
    left: -9999,
    top: -9999,
  });

  const syncPosition = useEffectEvent(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const rect = getPageFramePmScreenRectForElement(entry.view, entry.blockDom);
    if (!rect) {
      setStyle((current) =>
        current.visibility === 'hidden'
          ? current
          : { ...current, visibility: 'hidden' },
      );
      return;
    }

    const width = root.offsetWidth;
    const height = root.offsetHeight;
    // Each layout leaves an empty canvas band opposite its stacking axis: vertical/continuous stack
    // downward (room on the side), horizontal steps sideways (room below).
    const horizontal = layoutOf(entry.view) === 'horizontal';
    let left = horizontal ? rect.left : rect.right + ANCHOR_GAP;
    let top = horizontal ? rect.bottom + ANCHOR_GAP : rect.top;

    left = Math.max(
      EDGE_MARGIN,
      Math.min(left, window.innerWidth - width - EDGE_MARGIN),
    );
    top = Math.max(
      EDGE_MARGIN,
      Math.min(top, window.innerHeight - height - EDGE_MARGIN),
    );

    setStyle((current) =>
      current.left === left &&
      current.top === top &&
      current.visibility !== 'hidden'
        ? current
        : { left, top },
    );
  });

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      syncPosition();
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  // Dismiss when the block is deselected, mirroring the slash insert panel. Re-running the block
  // shows it again via codeRunStore.start.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        rootRef.current?.contains(target) ||
        entry.blockDom.contains(target)
      ) {
        return;
      }
      codeRunStore.setVisible(entry.id, false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, [entry.id, entry.blockDom]);

  // Follow the tail as new lines arrive, unless the user scrolled up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when line count grows
  useEffect(() => {
    const body = bodyRef.current;
    if (body && stickToBottom.current) {
      body.scrollTop = body.scrollHeight;
    }
  }, [entry.lines.length]);

  return (
    <div
      ref={rootRef}
      className="pm-code-block__output"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="pm-code-block__output-header">
        <span>Output</span>
        <button
          type="button"
          className="pm-code-block__output-close"
          aria-label="Hide output"
          onClick={() => codeRunStore.setVisible(entry.id, false)}
        >
          ×
        </button>
      </div>
      <div
        ref={bodyRef}
        className="pm-code-block__output-body"
        onScroll={() => {
          const body = bodyRef.current;
          if (body) {
            stickToBottom.current =
              body.scrollTop + body.clientHeight >=
              body.scrollHeight - STICK_THRESHOLD;
          }
        }}
      >
        <VirtualList
          scrollRef={bodyRef}
          count={entry.lines.length}
          estimateHeight={estimateLineHeight}
          getRowKey={getLineRowKey}
          gap={0}
          renderRow={(index) => {
            const line = entry.lines[index];
            return (
              <div
                className={
                  line.stream === 'stderr'
                    ? 'pm-code-block__output-line is-stderr'
                    : 'pm-code-block__output-line'
                }
              >
                {line.text === '' ? ' ' : line.text}
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}

function layoutOf(view: EditorView): string {
  const host = view.dom.closest(`.${PM_EDITOR_CLASS}`);
  return host?.getAttribute('data-page-layout') ?? 'vertical';
}
