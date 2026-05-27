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
