import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { ChromeMenuItem } from '../chrome-menu';

interface ChromeMenuProps {
  anchor: DOMRect;
  items: ChromeMenuItem[];
  onClose: () => void;
}

const MENU_MIN_WIDTH = 200;
const MENU_SIDE_OFFSET = 6;
const VIEWPORT_PAD = 12;

export function ChromeMenu({ anchor, items, onClose }: ChromeMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => computePosition(anchor, 0, 0));

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    setPos(computePosition(anchor, rect?.height ?? 0, rect?.width ?? 0));
  }, [anchor]);

  useEffect(() => {
    const onDocPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, y: -4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -2, scale: 0.98 }}
      transition={{ duration: 0.14, ease: [0.25, 0.1, 0.25, 1] }}
      className="pointer-events-auto fixed z-[100] min-w-[200px] origin-top-right overflow-hidden rounded-xl bg-popover/90 p-1.5 shadow-ambient outline-none backdrop-blur-2xl"
      style={{ top: pos.top, left: pos.left, minWidth: MENU_MIN_WIDTH }}
      role="menu"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const danger = item.variant === 'danger';
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onPointerDown={(e) => {
              // Mouse menu interaction should not steal focus from an active
              // page-frame editor; the click still fires normally.
              e.preventDefault();
            }}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className={`group flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none bg-transparent px-3 py-2 text-left text-sm outline-none transition-colors ${
              danger
                ? 'text-destructive hover:bg-destructive/10'
                : 'text-text-secondary hover:bg-surface hover:text-text-primary focus-visible:bg-surface focus-visible:text-text-primary'
            }`}
          >
            {Icon && (
              <Icon
                className={
                  danger
                    ? 'size-4 text-destructive'
                    : 'size-4 text-text-muted transition-colors group-hover:text-text-secondary'
                }
              />
            )}
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        );
      })}
    </motion.div>
  );
}

function computePosition(
  anchor: DOMRect,
  menuHeight: number,
  menuWidth: number,
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.max(menuWidth, MENU_MIN_WIDTH);

  // Prefer right-aligned under the anchor; fall back to left-aligned if
  // that would clip the left edge.
  let left = anchor.right - width;
  if (left < VIEWPORT_PAD) {
    left = anchor.left;
  }
  left = Math.max(VIEWPORT_PAD, Math.min(left, vw - width - VIEWPORT_PAD));

  let top = anchor.bottom + MENU_SIDE_OFFSET;
  if (menuHeight > 0 && top + menuHeight > vh - VIEWPORT_PAD) {
    top = Math.max(VIEWPORT_PAD, anchor.top - MENU_SIDE_OFFSET - menuHeight);
  }

  return { top, left };
}
