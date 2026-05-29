import type { PaneId, TabId } from './types';

export const TAB_DRAG_MIME = 'application/myelin-tab';

export interface TabDragData {
  tabId: TabId;
  sourcePaneId: PaneId;
}

export function setTabDragData(
  dataTransfer: DataTransfer,
  data: TabDragData,
): void {
  dataTransfer.setData(TAB_DRAG_MIME, JSON.stringify(data));
}

export function getTabDragData(dataTransfer: DataTransfer): TabDragData | null {
  const raw = dataTransfer.getData(TAB_DRAG_MIME);
  if (!raw) {
    return null;
  }

  const data = JSON.parse(raw) as Partial<TabDragData>;
  if (typeof data.tabId !== 'string' || typeof data.sourcePaneId !== 'string') {
    return null;
  }

  return {
    tabId: data.tabId,
    sourcePaneId: data.sourcePaneId,
  };
}

export function computeTabDropIndex(
  container: Element,
  tabCount: number,
  clientX: number,
): number {
  const tabElements = container.querySelectorAll('[data-tab-id]');
  let targetIndex = tabCount;
  let closestDist = Infinity;

  tabElements.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const dist = Math.abs(clientX - center);
    if (dist < closestDist) {
      closestDist = dist;
      targetIndex = clientX < center ? i : i + 1;
    }
  });

  return targetIndex;
}

export function setupDragGhost(e: React.DragEvent, tabEl: HTMLElement): void {
  const ghost = tabEl.cloneNode(true) as HTMLElement;
  ghost.style.position = 'fixed';
  ghost.style.top = '-9999px';
  ghost.style.left = '-9999px';
  ghost.style.width = `${tabEl.offsetWidth}px`;
  ghost.style.height = `${tabEl.offsetHeight}px`;
  ghost.style.borderRadius = '8px';
  ghost.style.boxShadow =
    '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08)';
  ghost.style.opacity = '0.92';
  ghost.style.background = 'var(--bg-page)';
  ghost.style.pointerEvents = 'none';

  document.body.appendChild(ghost);

  const rect = tabEl.getBoundingClientRect();
  e.dataTransfer.setDragImage(
    ghost,
    e.clientX - rect.left,
    e.clientY - rect.top,
  );

  requestAnimationFrame(() => {
    document.body.removeChild(ghost);
  });
}
