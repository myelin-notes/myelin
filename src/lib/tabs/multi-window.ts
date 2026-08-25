import { isWindows } from '@myelin/shared/os';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  getAllWebviewWindows,
  getCurrentWebviewWindow,
  WebviewWindow,
} from '@tauri-apps/api/webviewWindow';
import type { Tab } from './types';

// Fired by a window when it drops one of its tabs onto another window's area.
// The receiving window adopts the tab into its focused pane.
const TAB_DROP_EVENT = 'myelin://tab-drop';

export function spawnWindow(tab: Tab): Promise<void> {
  const label = `myelin-${crypto.randomUUID().slice(0, 8)}`;
  const encoded = encodeURIComponent(JSON.stringify(tab));
  const win = new WebviewWindow(label, {
    url: `/?init-tab=${encoded}`,
    width: 1100,
    height: 700,
    titleBarStyle: 'overlay',
    hiddenTitle: true,
    // Windows is frameless (the tab bar is the title bar); macOS keeps native
    // decorations so titleBarStyle: Overlay can draw the traffic lights.
    decorations: !isWindows,
  });

  return new Promise((resolve, reject) => {
    win.once('tauri://created', () => resolve());
    win.once('tauri://error', (e) => reject(e));
  });
}

export function isTabDragOutsideWindow(e: DragEvent): boolean {
  const margin = 8;
  return (
    e.clientX <= margin ||
    e.clientY <= margin ||
    e.clientX >= window.innerWidth - margin ||
    e.clientY >= window.innerHeight - margin
  );
}

// Hand `tab` to another myelin window whose frame contains the drop point
// (screen coordinates, CSS pixels). Returns true if a window accepted it, in
// which case the caller should close the source tab. HTML5 drag events do not
// cross native window boundaries, so we resolve the target geometrically on
// drag end rather than via a drop handler in the other window.
export async function dropTabOntoWindow(
  tab: Tab,
  screenX: number,
  screenY: number,
): Promise<boolean> {
  const current = getCurrentWebviewWindow();
  const windows = await getAllWebviewWindows();

  for (const win of windows) {
    if (win.label === current.label) {
      continue;
    }
    try {
      const [position, size, scale] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        win.scaleFactor(),
      ]);
      const left = position.x / scale;
      const top = position.y / scale;
      const right = left + size.width / scale;
      const bottom = top + size.height / scale;

      if (
        screenX >= left &&
        screenX <= right &&
        screenY >= top &&
        screenY <= bottom
      ) {
        await emitTo(win.label, TAB_DROP_EVENT, tab);
        await win.setFocus();
        return true;
      }
    } catch {
      // Window may be mid-close or unreadable; skip it.
    }
  }

  return false;
}

export function listenForTabDrops(
  onTab: (tab: Tab) => void,
): Promise<UnlistenFn> {
  return listen<Tab>(TAB_DROP_EVENT, (event) => {
    onTab(event.payload);
  });
}
