import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { Tab } from './types';

export async function spawnWindow(tab: Tab): Promise<void> {
  const label = `myelin-${crypto.randomUUID().slice(0, 8)}`;
  const newWindow = new WebviewWindow(label, {
    url: '/',
    width: 1100,
    height: 700,
    titleBarStyle: 'overlay',
    hiddenTitle: true,
    decorations: true,
  });

  newWindow.once('tauri://created', async () => {
    await newWindow.emit('myelin:init-tab', {
      tab: JSON.parse(JSON.stringify(tab)),
    });
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
