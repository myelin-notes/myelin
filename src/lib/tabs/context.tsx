import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { createWindowStateWithTab, TabStateController } from './controller';
import type { PaneId, Tab, WindowState } from './types';

function readInitTab(): Tab | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('init-tab');
  if (!raw) {
    return null;
  }
  window.history.replaceState({}, '', '/');
  return JSON.parse(raw) as Tab;
}

const TabControllerContext = createContext<TabStateController | null>(null);
const PaneIdContext = createContext<PaneId | null>(null);

export function TabStateProvider({ children }: { children: ReactNode }) {
  const controller = useMemo(() => {
    const initTab = readInitTab();
    if (initTab) {
      return new TabStateController(createWindowStateWithTab(initTab));
    }
    return new TabStateController();
  }, []);

  return (
    <TabControllerContext.Provider value={controller}>
      {children}
    </TabControllerContext.Provider>
  );
}

export function PaneIdProvider({
  paneId,
  children,
}: {
  paneId: PaneId;
  children: ReactNode;
}) {
  return (
    <PaneIdContext.Provider value={paneId}>{children}</PaneIdContext.Provider>
  );
}

export function useTabController(): TabStateController {
  const controller = useContext(TabControllerContext);
  if (!controller) {
    throw new Error('useTabController must be used within TabStateProvider');
  }
  return controller;
}

export function useWindowState(): WindowState {
  const controller = useTabController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}

export function usePaneId(): PaneId {
  const paneId = useContext(PaneIdContext);
  if (!paneId) {
    throw new Error('usePaneId must be used within PaneIdProvider');
  }
  return paneId;
}
