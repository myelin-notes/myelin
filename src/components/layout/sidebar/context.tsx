import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { UserPrefs } from '@/lib/user-prefs';

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;

function clampWidth(width: number): number {
  return Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

interface SidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
  width: number;
  setWidth: (width: number) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidthState] = useState(() =>
    clampWidth(UserPrefs.get('sidebarWidth')),
  );

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);
  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    setWidthState(clamped);
    UserPrefs.set('sidebarWidth', clamped);
  }, []);

  const value = useMemo(
    () => ({ collapsed, toggle, width, setWidth }),
    [collapsed, toggle, width, setWidth],
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
