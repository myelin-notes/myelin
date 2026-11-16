import {
  type HTMLAttributes,
  type RefObject,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from 'react';
import {
  getVisibleElementBounds,
  subscribeVisibleViewport,
} from '@myelin/shared/visible-viewport';
import { IS_PHONE_BUILD } from '@/lib/viewport-scale';
import { getToolbarPanelTop } from './toolbar-panel-position';

const PANEL_MARGIN = 16;

interface ToolbarPanelProps extends HTMLAttributes<HTMLDivElement> {
  toolbarRef: RefObject<HTMLElement | null>;
  /** Viewport y the panel wants its top at. Unused on compact, where it hangs above the bar. */
  getDesiredTop: (panelHeight: number) => number;
}

/**
 * A panel hanging off the canvas toolbar, kept inside the on-screen part of the canvas. Its contents
 * must scroll within `--toolbar-panel-room`, which the toolbar sets, for this to hold when it's tall.
 */
export function ToolbarPanel({
  toolbarRef,
  getDesiredTop,
  ...props
}: ToolbarPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const sync = useEffectEvent(() => {
    const panel = panelRef.current;
    const toolbar = toolbarRef.current;
    const canvas = toolbar?.offsetParent;
    if (IS_PHONE_BUILD || !(panel && toolbar && canvas)) {
      return;
    }
    // offsetHeight, as panels zoom in on open and a transformed rect would under-report.
    const panelHeight = panel.offsetHeight;
    const top = getToolbarPanelTop({
      desiredTop: getDesiredTop(panelHeight),
      panelHeight,
      bounds: getVisibleElementBounds(canvas),
      margin: PANEL_MARGIN,
    });
    panel.style.top = `${Math.round(top - toolbar.getBoundingClientRect().top)}px`;
  });

  // Every render: the anchor can move, e.g. to another tool, without anything resizing.
  useLayoutEffect(() => {
    sync();
  });

  useLayoutEffect(() => {
    const resizeObserver = new ResizeObserver(() => sync());
    if (panelRef.current) {
      resizeObserver.observe(panelRef.current);
    }
    if (toolbarRef.current) {
      resizeObserver.observe(toolbarRef.current);
    }
    const unsubscribe = subscribeVisibleViewport(() => sync());
    return () => {
      resizeObserver.disconnect();
      unsubscribe();
    };
  }, [toolbarRef]);

  return <div ref={panelRef} {...props} />;
}
