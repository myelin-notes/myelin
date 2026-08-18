import {
  type CSSProperties,
  useCallback,
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
import { DisplayItemView } from './run-display';
import { type CodeRunEntry, type CodeRunItem, codeRunStore } from './run-store';

const ANCHOR_GAP = 12;
const EDGE_MARGIN = 12;
/** Row height before measurement; corrected once each row mounts. */
const ESTIMATED_LINE_HEIGHT = 18;
/** Rich output is taller than a line; a closer guess keeps scrolling steadier
 * while the real height is measured. */
const ESTIMATED_DISPLAY_HEIGHT = 200;
/** Treat the body as "at the bottom" within this many px (tail-follow). */
const STICK_THRESHOLD = 4;

// Stable identity: the virtualizer keys its memoized layout off this, so
// passing a fresh closure each render would force an O(item count) rebuild on
// every scroll frame.
const getLineRowKey = (index: number) => String(index);

/**
 * Renders the floating output overlay for every active code run. Anchored to
 * each block in screen space and tracked through canvas pan/zoom via a rAF
 * loop; output lines are windowed with {@link VirtualList} so large output
 * stays cheap. Mounted once in the page-frame DOM layer.
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
    // Each layout leaves an empty canvas band opposite its stacking axis:
    // vertical/continuous stack downward (room on the side), horizontal steps
    // sideways (room below).
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

  // Dismiss on pointer-down outside the block and the panel — i.e. when the
  // block is deselected — mirroring the slash insert panel. Re-running the
  // block shows it again via codeRunStore.start.
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

  // Follow the tail as new output arrives, unless the user scrolled up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when item count grows
  useEffect(() => {
    const body = bodyRef.current;
    if (body && stickToBottom.current) {
      body.scrollTop = body.scrollHeight;
    }
  }, [entry.items.length]);

  // `entry.items` is mutated in place by the store, so this identity is stable
  // and the virtualizer's layout memo survives re-renders.
  const estimateRowHeight = useCallback(
    (index: number) =>
      entry.items[index]?.kind === 'display'
        ? ESTIMATED_DISPLAY_HEIGHT
        : ESTIMATED_LINE_HEIGHT,
    [entry.items],
  );

  return (
    <div
      ref={rootRef}
      className={
        entry.hasDisplay
          ? 'pm-code-block__output has-display'
          : 'pm-code-block__output'
      }
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
          count={entry.items.length}
          estimateHeight={estimateRowHeight}
          getRowKey={getLineRowKey}
          gap={0}
          renderRow={(index) => <OutputRow item={entry.items[index]} />}
        />
      </div>
    </div>
  );
}

function OutputRow({ item }: { item: CodeRunItem }) {
  if (item.kind === 'display') {
    return (
      <div className="pm-code-block__output-display">
        <DisplayItemView payload={item.payload} />
      </div>
    );
  }
  return (
    <div
      className={
        item.stream === 'stderr'
          ? 'pm-code-block__output-line is-stderr'
          : 'pm-code-block__output-line'
      }
    >
      {item.text === '' ? ' ' : item.text}
    </div>
  );
}

function layoutOf(view: EditorView): string {
  const host = view.dom.closest(`.${PM_EDITOR_CLASS}`);
  return host?.getAttribute('data-page-layout') ?? 'vertical';
}
