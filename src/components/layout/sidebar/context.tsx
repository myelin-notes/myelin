import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { IS_MOBILE_BUILD } from '@/lib/env';
import { UserPrefs } from '@/lib/user-prefs';

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;

// Below this viewport width the persistent column can't coexist with usable
// content, so the sidebar becomes an overlay drawer instead. Runtime/adaptive
// by design — the same Sidebar reflows, it isn't a separate mobile UI.
const SIDEBAR_COMPACT_QUERY = '(max-width: 767px)';

function clampWidth(width: number): number {
  return Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

interface SidebarContextValue {
  /** Desktop layout: the persistent column is hidden (manual toggle). */
  collapsed: boolean;
  /** Viewport is narrow, so the sidebar renders as an overlay drawer. */
  isCompact: boolean;
  /**
   * Mobile build on a roomy (tablet-sized) viewport: replace the sidebar
   * entirely with a full-page library home. False on narrow screens even in a
   * mobile build, so a phone-sized viewport still falls back to the compact
   * drawer.
   */
  tabletLayout: boolean;
  /** Compact layout: the overlay drawer is open. */
  drawerOpen: boolean;
  /** Flips visibility for the current mode: drawer when compact, else column. */
  toggle: () => void;
  /** Closes the compact drawer; no-op in desktop layout. */
  close: () => void;
  width: number;
  setWidth: (width: number) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const isCompact = useMediaQuery(SIDEBAR_COMPACT_QUERY);
  const tabletLayout = IS_MOBILE_BUILD && !isCompact;
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [width, setWidthState] = useState(() =>
    clampWidth(UserPrefs.get('sidebarWidth')),
  );

  const toggle = useCallback(() => {
    if (isCompact) {
      setDrawerOpen((prev) => !prev);
    } else {
      setCollapsed((prev) => !prev);
    }
  }, [isCompact]);
  const close = useCallback(() => setDrawerOpen(false), []);
  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    setWidthState(clamped);
    UserPrefs.set('sidebarWidth', clamped);
  }, []);

  const value = useMemo(
    () => ({
      collapsed,
      isCompact,
      tabletLayout,
      drawerOpen,
      toggle,
      close,
      width,
      setWidth,
    }),
    [
      collapsed,
      isCompact,
      tabletLayout,
      drawerOpen,
      toggle,
      close,
      width,
      setWidth,
    ],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return context;
}
