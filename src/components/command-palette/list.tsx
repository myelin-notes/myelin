import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { CommandPaletteItem } from './types';
import {
  getScrollTopForVisibleItem,
  shouldActivatePointerSelection,
  type PointerPosition,
} from './utils';

export function CommandPaletteList({
  items,
  activeIndex,
  onActiveIndexChange,
  onRunItem,
}: {
  items: CommandPaletteItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onRunItem: (item: CommandPaletteItem) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pointerDrivenIndexRef = useRef<number | null>(null);
  const lastPointerPositionRef = useRef<PointerPosition | null>(null);
  const pointerHoverSuspendedRef = useRef(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const activeItemId = items[activeIndex]?.id;
  let previousSection = '';

  useEffect(() => {
    const viewport = viewportRef.current;
    const item = itemRefs.current[activeIndex];
    if (!(viewport && item && activeItemId)) {
      return;
    }

    viewport.scrollTop = getScrollTopForVisibleItem(viewport, item);
  }, [activeIndex, activeItemId]);

  useEffect(() => {
    if (pointerDrivenIndexRef.current === activeIndex) {
      pointerDrivenIndexRef.current = null;
      return;
    }

    setHoveredIndex((index) => (index === activeIndex ? index : null));
    pointerHoverSuspendedRef.current = true;
  }, [activeIndex]);

  return (
    <div
      ref={viewportRef}
      className="max-h-[min(26rem,56vh)] space-y-1 overflow-y-auto"
      onMouseLeave={() => {
        setHoveredIndex(null);
        lastPointerPositionRef.current = null;
      }}
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        const showSection = item.section !== previousSection;
        previousSection = item.section;
        const active = index === activeIndex;
        const hovered = index === hoveredIndex;

        return (
          <div
            key={item.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
          >
            {showSection && (
              <div className="px-3 pt-2 pb-1 font-semibold text-[10px] text-text-muted uppercase tracking-[0.16em]">
                {item.section}
              </div>
            )}
            <button
              type="button"
              disabled={item.disabled}
              onMouseMove={(event) => {
                if (item.disabled) {
                  return;
                }

                const pointerPosition = {
                  clientX: event.clientX,
                  clientY: event.clientY,
                };
                const previousPointerPosition = lastPointerPositionRef.current;
                lastPointerPositionRef.current = pointerPosition;

                if (
                  !shouldActivatePointerSelection(
                    previousPointerPosition,
                    pointerPosition,
                    pointerHoverSuspendedRef.current,
                  )
                ) {
                  return;
                }

                pointerHoverSuspendedRef.current = false;

                if (hoveredIndex !== index) {
                  setHoveredIndex(index);
                }
                if (!active) {
                  pointerDrivenIndexRef.current = index;
                  onActiveIndexChange(index);
                }
              }}
              onClick={() => onRunItem(item)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                (active || hovered) && 'bg-hover-tint',
                item.disabled
                  ? 'cursor-default opacity-50'
                  : 'cursor-pointer',
              )}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-text-secondary">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-sm text-text-primary">
                  {item.label}
                </div>
                <div className="truncate text-[12px] text-text-muted">
                  {item.description}
                </div>
              </div>
              {item.shortcut && (
                <kbd className="rounded-md border border-border-divider bg-white px-1.5 py-0.5 font-semibold text-[10px] text-text-secondary">
                  {item.shortcut}
                </kbd>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
