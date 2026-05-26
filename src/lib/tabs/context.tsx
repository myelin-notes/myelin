import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  createWindowStateWithTab,
  TabStateController,
} from './controller';
import type { PaneId, Tab, WindowState } from './types';

const TabControllerContext = createContext<TabStateController | null>(null);
const PaneIdContext = createContext<PaneId | null>(null);

export function TabStateProvider({ children }: { children: ReactNode }) {
  const controller = useMemo(() => new TabStateController(), []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ tab: Tab }>('myelin:init-tab', (event) => {
      controller.replaceState(createWindowStateWithTab(event.payload.tab));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [controller]);

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
