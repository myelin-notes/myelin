import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Check as CheckIcon } from 'lucide-react';
import type { ChromeMenuItem } from '@myelin/editor/chrome-menu';

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
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState(() => computePosition(anchor, 0, 0));
  const [focusedIndex, setFocusedIndex] = useState(0);
  const handleDocumentPointerDown = useEffectEvent((event: PointerEvent) => {
    if (!menuRef.current?.contains(event.target as Node)) {
      onClose();
    }
  });
  const handleDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    }
  });

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    setPos(computePosition(anchor, rect?.height ?? 0, rect?.width ?? 0));
  }, [anchor]);

  useEffect(() => {
    const onDocPointerDown = (event: PointerEvent) => {
      handleDocumentPointerDown(event);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      handleDocumentKeyDown(event);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (focusedIndex >= items.length) {
      setFocusedIndex(Math.max(0, items.length - 1));
      return;
    }
    itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex, items.length]);

  const moveFocus = (delta: number) => {
    if (items.length === 0) {
      return;
    }
    setFocusedIndex((prev) => (prev + delta + items.length) % items.length);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'Home':
        event.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setFocusedIndex(Math.max(0, items.length - 1));
        break;
      case 'Tab':
        event.preventDefault();
        moveFocus(event.shiftKey ? -1 : 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={menuRef}
      className="fade-in-0 slide-in-from-top-1 zoom-in-95 pointer-events-auto fixed z-[100] min-w-[200px] origin-top-right animate-in overflow-hidden rounded-xl bg-popover/90 p-1.5 shadow-ambient outline-none backdrop-blur-2xl duration-[140ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]"
      style={{ top: pos.top, left: pos.left, minWidth: MENU_MIN_WIDTH }}
      role="menu"
      onKeyDown={onMenuKeyDown}
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        const danger = item.variant === 'danger';
        const isCheckable = item.checked !== undefined;
        const roleProps = isCheckable
          ? ({
              role: 'menuitemradio',
              'aria-checked': item.checked,
            } as const)
          : ({ role: 'menuitem' } as const);
        return (
          <button
            key={item.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            {...roleProps}
            tabIndex={index === focusedIndex ? 0 : -1}
            onPointerDown={(e) => {
              // Mouse menu interaction should not steal focus from an active
              // page-frame editor; the click still fires normally.
              e.preventDefault();
            }}
            onFocus={() => setFocusedIndex(index)}
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
            {item.checked && (
              <CheckIcon
                aria-hidden="true"
                className="size-4 text-text-primary"
                strokeWidth={1.5}
              />
            )}
          </button>
        );
      })}
    </div>
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
