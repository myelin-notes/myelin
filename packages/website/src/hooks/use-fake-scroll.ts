import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';

/** Accumulated wheel distance (px) that counts as one scene step. */
const STEP_THRESHOLD = 150;
/** Ignore further wheel input while the camera flies to the new scene. */
const STEP_COOLDOWN_MS = 620;

interface FakeScrollOptions {
  sceneCount: number;
  /**
   * When true the wheel is left alone (e.g. a page frame is being edited and
   * the engine routes wheel to scrolling it, or a toolbar menu is open).
   */
  isBlocked: () => boolean;
  onIndexChange: (index: number) => void;
}

/**
 * The site's fake scroll: there is no scrollable document, only a virtual
 * scroll value accumulated from wheel/keyboard input. Crossing a threshold
 * advances the active scene, which the caller translates into a camera move.
 *
 * Wheel is intercepted in the capture phase so the canvas viewport (which
 * otherwise wheel-pans) never sees it; ctrl+wheel / trackpad pinch is passed
 * through so visitors can still zoom the real canvas, and anything inside a
 * `[data-canvas-ui]` container (toolbar menus) keeps native scrolling.
 */
export function useFakeScroll({
  sceneCount,
  isBlocked,
  onIndexChange,
}: FakeScrollOptions) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const accumulatedRef = useRef(0);
  const cooldownUntilRef = useRef(0);

  const notify = useEffectEvent(onIndexChange);
  const blocked = useEffectEvent(isBlocked);

  const goTo = useCallback(
    (target: number) => {
      const next = Math.max(0, Math.min(sceneCount - 1, target));
      accumulatedRef.current = 0;
      cooldownUntilRef.current = performance.now() + STEP_COOLDOWN_MS;
      indexRef.current = next;
      setIndex(next);
      // Notify even when the index is unchanged: re-selecting the current
      // scene re-centers the camera after the visitor panned away.
      notify(next);
    },
    [sceneCount],
  );

  useEffect(() => {
    const handleWheel = (evt: WheelEvent) => {
      if (evt.ctrlKey) {
        return;
      }
      const target = evt.target instanceof Element ? evt.target : null;
      if (target?.closest('[data-canvas-ui]')) {
        return;
      }
      if (blocked()) {
        return;
      }
      evt.preventDefault();
      evt.stopPropagation();

      const now = performance.now();
      if (now < cooldownUntilRef.current) {
        return;
      }
      const delta =
        evt.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? evt.deltaY * 16
          : evt.deltaY;
      if (Math.sign(delta) !== Math.sign(accumulatedRef.current)) {
        accumulatedRef.current = 0;
      }
      accumulatedRef.current += delta;
      if (Math.abs(accumulatedRef.current) < STEP_THRESHOLD) {
        return;
      }
      const dir = accumulatedRef.current > 0 ? 1 : -1;
      accumulatedRef.current = 0;
      const next = indexRef.current + dir;
      if (next < 0 || next >= sceneCount) {
        return;
      }
      cooldownUntilRef.current = now + STEP_COOLDOWN_MS;
      indexRef.current = next;
      setIndex(next);
      notify(next);
    };

    const handleKey = (evt: KeyboardEvent) => {
      if (evt.defaultPrevented || evt.metaKey || evt.ctrlKey || evt.altKey) {
        return;
      }
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === 'TEXTAREA' ||
          active.tagName === 'INPUT' ||
          active.isContentEditable)
      ) {
        return;
      }
      if (blocked()) {
        return;
      }
      let next: number;
      switch (evt.key) {
        case 'ArrowDown':
        case 'ArrowRight':
        case 'PageDown':
          next = indexRef.current + 1;
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'PageUp':
          next = indexRef.current - 1;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = sceneCount - 1;
          break;
        default:
          return;
      }
      if (next < 0 || next >= sceneCount) {
        return;
      }
      evt.preventDefault();
      goTo(next);
    };

    window.addEventListener('wheel', handleWheel, {
      capture: true,
      passive: false,
    });
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('keydown', handleKey);
    };
  }, [sceneCount, goTo]);

  return { index, goTo };
}
