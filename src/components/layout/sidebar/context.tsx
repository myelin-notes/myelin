import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { IS_MOBILE_BUILD } from '@/lib/env';
import { IS_PHONE_BUILD } from '@/lib/viewport-scale';

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;

// Below this width the persistent column can't coexist with usable content, so the sidebar becomes
// an overlay drawer. Only reached on desktop builds; mobile builds skip the sidebar entirely.
const SIDEBAR_COMPACT_MAX_WIDTH = 767;
const SIDEBAR_COMPACT_QUERY = `(max-width: ${SIDEBAR_COMPACT_MAX_WIDTH}px)`;

function clampWidth(width: number): number {
  return Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

interface SidebarContextValue {
  /** Desktop layout: the persistent column is hidden (manual toggle). */
  collapsed: boolean;
  /** Viewport is narrow, so the sidebar renders as an overlay drawer. */
  isCompact: boolean;
  /**
   * Mobile build: replace the sidebar entirely with a full-page library home, at every mobile
   * viewport size — phones and tablets get the same layout.
   */
  mobileLayout: boolean;
  /**
   * Mobile build on a phone-sized screen. Narrower than {@link mobileLayout}: the tab strip is
   * replaced by the active document's title, and the tab controller keeps a single tab per pane.
   */
  phoneLayout: boolean;
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
      mobileLayout: IS_MOBILE_BUILD,
      phoneLayout: IS_PHONE_BUILD,
      drawerOpen,
      toggle,
      close,
      width,
      setWidth,
    }),
    [collapsed, isCompact, drawerOpen, toggle, close, width, setWidth],
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
