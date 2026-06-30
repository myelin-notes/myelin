import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, useSidebar } from './context';
import { useResizeHandle } from './use-resize-handle';

/**
 * 1px divider on the sidebar's right edge that doubles as a horizontal resize
 * handle. The visible line matches the rest of the chrome; the grab zone is an
 * invisible strip extended into the main area (kept off the sidebar so it never
 * covers the tree's scrollbar).
 */
export function SidebarResizeHandle() {
  const { width, setWidth } = useSidebar();
  const handleProps = useResizeHandle({
    axis: 'x',
    value: width,
    onChange: setWidth,
  });

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      {...handleProps}
      className="group relative z-10 w-px shrink-0 cursor-col-resize bg-border-subtle outline-none transition-colors duration-150 hover:bg-accent-dark/30 focus-visible:bg-accent-dark/40"
    >
      <span aria-hidden className="absolute inset-y-0 -right-1.5 left-0" />
    </div>
  );
}
