import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { Tab } from './types';

export function spawnWindow(tab: Tab): Promise<void> {
  const label = `myelin-${crypto.randomUUID().slice(0, 8)}`;
  const encoded = encodeURIComponent(JSON.stringify(tab));
  const win = new WebviewWindow(label, {
    url: `/?init-tab=${encoded}`,
    width: 1100,
    height: 700,
    titleBarStyle: 'overlay',
    hiddenTitle: true,
    decorations: true,
  });

  return new Promise((resolve, reject) => {
    win.once('tauri://created', () => resolve());
    win.once('tauri://error', (e) => reject(e));
  });
}

export function isTabDragOutsideWindow(e: DragEvent): boolean {
  const margin = 20;
  return (
    e.clientX < margin ||
    e.clientY < margin ||
    e.clientX > window.innerWidth - margin ||
    e.clientY > window.innerHeight - margin
  );
}
