export interface VisibleBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * System-bar insets in CSS px, read off the padding `#root` applies for them. On edge-to-edge
 * Android and iOS the window runs under those bars, so its own size overstates the usable room.
 */
export function getSafeAreaInsets(): SafeAreaInsets {
  const root = document.getElementById('root');
  if (!root) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const style = getComputedStyle(root);
  return {
    top: Number.parseFloat(style.paddingTop) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
  };
}

/**
 * The part of the window content can occupy, in viewport coords: the visual viewport, which stops
 * at an open keyboard, clipped to the area clear of the system bars. Clipped rather than subtracted
 * so the bottom inset isn't counted twice while a keyboard covers it.
 */
export function getVisibleViewportBounds(): VisibleBounds {
  const insets = getSafeAreaInsets();
  const visual = window.visualViewport;
  const visualLeft = visual?.offsetLeft ?? 0;
  const visualTop = visual?.offsetTop ?? 0;
  return {
    left: Math.max(visualLeft, insets.left),
    top: Math.max(visualTop, insets.top),
    right: Math.min(
      visualLeft + (visual?.width ?? window.innerWidth),
      window.innerWidth - insets.right,
    ),
    bottom: Math.min(
      visualTop + (visual?.height ?? window.innerHeight),
      window.innerHeight - insets.bottom,
    ),
  };
}

/** The on-screen part of `element`, in viewport coords. Empty bounds can have `right < left`. */
export function getVisibleElementBounds(element: Element): VisibleBounds {
  const rect = element.getBoundingClientRect();
  const viewport = getVisibleViewportBounds();
  return {
    left: Math.max(rect.left, viewport.left),
    top: Math.max(rect.top, viewport.top),
    right: Math.min(rect.right, viewport.right),
    bottom: Math.min(rect.bottom, viewport.bottom),
  };
}

/** Calls `onChange` when the window or visual viewport changes. Returns the unsubscribe. */
export function subscribeVisibleViewport(onChange: () => void): () => void {
  const visual = window.visualViewport;
  window.addEventListener('resize', onChange);
  visual?.addEventListener('resize', onChange);
  visual?.addEventListener('scroll', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    visual?.removeEventListener('resize', onChange);
    visual?.removeEventListener('scroll', onChange);
  };
}
