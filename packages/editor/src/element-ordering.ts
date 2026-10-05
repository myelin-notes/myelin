import { type ElementType, isBackgroundElement } from './elements/element-type';

export type ElementReorderDirection = 'higher' | 'lower';

export interface ElementOrderItem {
  uuid: string;
  type: ElementType;
}

function getElementLayer(type: ElementType): number {
  return isBackgroundElement(type) ? 0 : 1;
}

function canSwapElementOrder(
  a: ElementOrderItem,
  b: ElementOrderItem,
  selectedUuids: ReadonlySet<string>,
): boolean {
  return (
    getElementLayer(a.type) === getElementLayer(b.type) &&
    selectedUuids.has(a.uuid) &&
    !selectedUuids.has(b.uuid)
  );
}

export function canMoveElementOrderForSelection(
  items: readonly ElementOrderItem[],
  selectedUuids: Iterable<string>,
  direction: ElementReorderDirection,
): boolean {
  const selected = new Set(selectedUuids);
  if (selected.size === 0) {
    return false;
  }

  if (direction === 'higher') {
    for (let i = 0; i < items.length - 1; i++) {
      if (canSwapElementOrder(items[i], items[i + 1], selected)) {
        return true;
      }
    }
    return false;
  }

  for (let i = 1; i < items.length; i++) {
    if (canSwapElementOrder(items[i], items[i - 1], selected)) {
      return true;
    }
  }
  return false;
}

export function moveElementOrderForSelection(
  items: readonly ElementOrderItem[],
  selectedUuids: Iterable<string>,
  direction: ElementReorderDirection,
): string[] {
  const selected = new Set(selectedUuids);
  const next = [...items];

  if (direction === 'higher') {
    for (let i = next.length - 2; i >= 0; i--) {
      if (canSwapElementOrder(next[i], next[i + 1], selected)) {
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
      }
    }
  } else {
    for (let i = 1; i < next.length; i++) {
      if (canSwapElementOrder(next[i], next[i - 1], selected)) {
        [next[i], next[i - 1]] = [next[i - 1], next[i]];
      }
    }
  }

  return next.map((item) => item.uuid);
}
