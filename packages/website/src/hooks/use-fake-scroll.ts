import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';

/** Wheel distance (px) that moves the camera exactly one scene. */
const SCROLL_PER_SCENE = 600;
/**
 * Time constant (ms) of the exponential smoothing that pulls the rendered
 * position toward the raw scroll value. Mouse wheels arrive as coarse notches
 * and rail/keyboard jumps arrive all at once; smoothing turns both into a
 * continuous glide without ever holding input back.
 */
const SMOOTHING_TAU_MS = 120;
/** Remaining travel (in scenes) at which we land exactly and stop the loop. */
const SETTLE_EPSILON = 0.0005;
/**
 * How close (in scenes) the wheel has to stop to the scene it is heading
 * toward for that scene to pull it the rest of the way in.
 */
const SNAP_RANGE = 0.25;
/** Quiet time after the last wheel event before the magnet is allowed to act. */
const SNAP_IDLE_MS = 160;

interface FakeScrollOptions {
  sceneCount: number;
  /**
   * When true the wheel is left alone (e.g. a page frame is being edited and
   * the engine routes wheel to scrolling it, or a toolbar menu is open).
   */
  isBlocked: () => boolean;
  /** Called each frame with the current position, in fractional scene units. */
  onScroll: (progress: number) => void;
}

/**
 * The site's fake scroll: there is no scrollable document, only a virtual
 * scroll value accumulated from wheel/keyboard input. That value is continuous
 * — scene 2.4 is a real position, 40% of the way from scene 2 to scene 3 — and
 * the caller interpolates the camera to match, so the view tracks the wheel
 * instead of stepping between fixed stops. Scenes are lightly magnetic in the
 * direction of travel: stop the wheel just short of the scene you are heading
 * for and it pulls you the rest of the way in.
 *
 * Wheel is intercepted in the capture phase so the canvas viewport (which
 * otherwise wheel-pans) never sees it; ctrl+wheel / trackpad pinch is passed
 * through so visitors can still zoom the real canvas, and anything inside a
 * `[data-canvas-ui]` container (toolbar menus) keeps native scrolling.
 */
export function useFakeScroll({
  sceneCount,
  isBlocked,
  onScroll,
}: FakeScrollOptions) {
  const [index, setIndex] = useState(0);
  /** Rendered position; trails `targetRef` by the smoothing time constant. */
  const progressRef = useRef(0);
  /** Raw scroll value: where the input has asked to be, un-smoothed. */
  const targetRef = useRef(0);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /** Sign of the most recent wheel delta; the magnet only pulls this way. */
  const scrollDirRef = useRef(1);

  const emit = useEffectEvent(onScroll);
  const blocked = useEffectEvent(isBlocked);

  // Runs only while the rendered position is catching up, so the page is idle
  // whenever nobody is scrolling.
  const startLoop = useCallback(() => {
    if (rafRef.current) {
      return;
    }
    lastFrameRef.current = performance.now();
    const step = (now: number) => {
      // Clamped so a backgrounded tab doesn't resume with one huge jump.
      const dt = Math.min(64, now - lastFrameRef.current);
      lastFrameRef.current = now;

      const remaining = targetRef.current - progressRef.current;
      const settled = Math.abs(remaining) < SETTLE_EPSILON;
      progressRef.current = settled
        ? targetRef.current
        : progressRef.current +
          remaining * (1 - Math.exp(-dt / SMOOTHING_TAU_MS));

      emit(progressRef.current);
      setIndex(Math.round(progressRef.current));

      rafRef.current = settled ? 0 : requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const goTo = useCallback(
    (target: number) => {
      clearTimeout(snapTimerRef.current);
      targetRef.current = Math.max(0, Math.min(sceneCount - 1, target));
      // Started even when the target is unchanged: re-selecting the current
      // scene re-centers the camera after the visitor panned away.
      startLoop();
    },
    [sceneCount, startLoop],
  );

  /**
   * Once the wheel goes quiet, let the scene the visitor was heading toward
   * pull the position the rest of the way in — never the one they just left.
   * A magnet that also pulled backwards would undo a small overshoot by
   * reversing the visitor's own scroll, which reads as the page fighting them.
   * Retargets rather than jumps, so the same smoothing that carried the scroll
   * also carries the snap.
   */
  const snapAlongTravel = useCallback(() => {
    const ahead =
      scrollDirRef.current > 0
        ? Math.ceil(targetRef.current)
        : Math.floor(targetRef.current);
    if (Math.abs(ahead - targetRef.current) <= SNAP_RANGE) {
      goTo(ahead);
    }
  }, [goTo]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(snapTimerRef.current);
    };
  }, []);

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

      const delta =
        evt.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? evt.deltaY * 16
          : evt.deltaY;
      if (delta !== 0) {
        scrollDirRef.current = Math.sign(delta);
      }
      goTo(targetRef.current + delta / SCROLL_PER_SCENE);
      snapTimerRef.current = setTimeout(snapAlongTravel, SNAP_IDLE_MS);
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
      // Keys step between whole scenes, so they resolve a mid-pan position to
      // the nearest scene first rather than carrying its fraction along.
      const current = Math.round(targetRef.current);
      let next: number;
      switch (evt.key) {
        case 'ArrowDown':
        case 'ArrowRight':
        case 'PageDown':
          next = current + 1;
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'PageUp':
          next = current - 1;
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
  }, [sceneCount, goTo, snapAlongTravel]);

  const getProgress = useCallback(() => progressRef.current, []);

  return { index, goTo, getProgress };
}
