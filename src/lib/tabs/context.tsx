import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import {
  NODES_DELETED_EVENT,
  type NodesDeletedDetail,
} from '@myelin/editor/events';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useKeybindings } from '@/hooks/useKeybindings';
import { IS_PHONE_BUILD } from '@/lib/viewport-scale';
import { createWindowStateWithTab, TabStateController } from './controller';
import { listenForTabDrops } from './multi-window';
import type { PaneId, Tab, WindowState } from './types';

function readInitTab(): Tab | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('init-tab');
  if (!raw) {
    return null;
  }
  window.history.replaceState({}, '', '/');
  try {
    return JSON.parse(raw) as Tab;
  } catch {
    return null;
  }
}

const TabControllerContext = createContext<TabStateController | null>(null);
const PaneIdContext = createContext<PaneId | null>(null);

export function TabStateProvider({ children }: { children: ReactNode }) {
  const controller = useMemo(() => {
    const closeWindow = () => {
      void getCurrentWebviewWindow().close();
    };
    const options = { singleTab: IS_PHONE_BUILD };
    const initTab = readInitTab();
    if (initTab) {
      // Tabs torn off into their own window close that window when emptied.
      return new TabStateController(
        createWindowStateWithTab(initTab),
        closeWindow,
        options,
      );
    }
    // The main window never closes from emptying its tabs; it falls back to an
    // empty home pane (recents + welcome).
    return new TabStateController(undefined, undefined, options);
  }, []);

  useTabCloseShortcut(controller);
  useAdoptDroppedTabs(controller);
  useCloseDeletedTabs(controller);

  return (
    <TabControllerContext.Provider value={controller}>
      {children}
    </TabControllerContext.Provider>
  );
}

// Adopt tabs dropped onto this window from another window (reverse tear-off).
function useAdoptDroppedTabs(controller: TabStateController) {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenForTabDrops((tab) => {
      controller.openTab(tab.target, tab.title);
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [controller]);
}

// Close tabs whose document was deleted (from the sidebar, an MCP agent, or a
// deleted parent folder) so we never leave a live editor bound to a gone node.
function useCloseDeletedTabs(controller: TabStateController) {
  useEffect(() => {
    const handle = (event: Event) => {
      const { detail } = event as CustomEvent<NodesDeletedDetail>;
      controller.closeTabsForNodes(detail.ids);
    };
    window.addEventListener(NODES_DELETED_EVENT, handle);
    return () => window.removeEventListener(NODES_DELETED_EVENT, handle);
  }, [controller]);
}

function useTabCloseShortcut(controller: TabStateController) {
  const handleClose = useCallback(
    (e: KeyboardEvent) => {
      const pane = controller.getFocusedPane();
      if (!pane) {
        return;
      }
      e.preventDefault();
      if (pane.activePage) {
        controller.togglePanePage(pane.activePage, pane.id);
        return;
      }
      controller.closeTab(pane.activeTabId, pane.id);
    },
    [controller],
  );

  useKeybindings(
    useMemo(
      () => [{ action: 'tab:close', allowEditable: true, onDown: handleClose }],
      [handleClose],
    ),
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
