import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  FilePlus2 as FilePlusIcon,
  ImagePlus as ImagePlusIcon,
  type LucideIcon,
  Mic as MicIcon,
  Sigma as SigmaIcon,
} from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { getInsertHotkey } from '@myelin/editor/tools/tool-keybinds';

interface InsertPopoverProps {
  onInsertFrame: () => void;
  onInsertEmbed: () => void;
  onInsertLatex: () => void;
  onInsertAudio: () => void;
  onClose: () => void;
}

interface InsertItem {
  key: string;
  icon: LucideIcon;
  label: string;
  description: string;
  hotkey: string;
  disabled?: boolean;
  comingSoon?: boolean;
  onSelect?: () => void;
}

export function InsertPopover({
  onInsertFrame,
  onInsertEmbed,
  onInsertLatex,
  onInsertAudio,
  onClose,
}: InsertPopoverProps) {
  const strings = useMessages();
  const panelRef = useRef<HTMLDivElement>(null);
  const handleDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  });
  const handleDocumentPointerDown = useEffectEvent((event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (panelRef.current?.contains(target)) {
      return;
    }
    // Clicking the trigger ("+") is handled by its onClick toggle; ignore it
    // here so we don't fight the toggle.
    if (target?.closest('[data-insert-trigger]')) {
      return;
    }
    onClose();
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleDocumentKeyDown(event);
    };
    const onPointerDown = (event: PointerEvent) => {
      handleDocumentPointerDown(event);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  const items: InsertItem[] = [
    {
      key: 'frame',
      icon: FilePlusIcon,
      label: strings.canvas.insert.frame.label,
      description: strings.canvas.insert.frame.description,
      hotkey: getInsertHotkey('frame'),
      onSelect: onInsertFrame,
    },
    {
      key: 'embed',
      icon: ImagePlusIcon,
      label: strings.canvas.insert.embed.label,
      description: strings.canvas.insert.embed.description,
      hotkey: getInsertHotkey('embed'),
      onSelect: onInsertEmbed,
    },
    {
      key: 'latex',
      icon: SigmaIcon,
      label: strings.canvas.insert.latex.label,
      description: strings.canvas.insert.latex.description,
      hotkey: '',
      onSelect: onInsertLatex,
    },
    {
      key: 'audio',
      icon: MicIcon,
      label: strings.canvas.insert.audio.label,
      description: strings.canvas.insert.audio.description,
      hotkey: '',
      onSelect: onInsertAudio,
    },
  ];

  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const firstEnabledIndex = items.findIndex((item) => !item.disabled);
  const [focusedIndex, setFocusedIndex] = useState(
    firstEnabledIndex === -1 ? 0 : firstEnabledIndex,
  );

  useEffect(() => {
    itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  const findNextEnabled = (start: number, delta: number) => {
    if (items.length === 0) {
      return start;
    }
    let i = start;
    for (let step = 0; step < items.length; step++) {
      i = (i + delta + items.length) % items.length;
      if (!items[i].disabled) {
        return i;
      }
    }
    return start;
  };

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setFocusedIndex((prev) => findNextEnabled(prev, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setFocusedIndex((prev) => findNextEnabled(prev, -1));
        break;
      case 'Home':
        event.preventDefault();
        setFocusedIndex(findNextEnabled(items.length - 1, 1));
        break;
      case 'End':
        event.preventDefault();
        setFocusedIndex(findNextEnabled(0, -1));
        break;
      case 'Tab':
        event.preventDefault();
        setFocusedIndex((prev) =>
          findNextEnabled(prev, event.shiftKey ? -1 : 1),
        );
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={panelRef}
      className="fade-in-0 slide-in-from-left-2 zoom-in-95 ml-2 w-[260px] animate-in overflow-hidden rounded-2xl bg-popover/85 shadow-ambient backdrop-blur-[24px] duration-[220ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]"
      role="menu"
      onKeyDown={onPanelKeyDown}
    >
      <div className="px-4 pt-3 pb-1">
        <span className="font-medium text-[10px] text-text-muted uppercase tracking-[0.18em]">
          {strings.canvas.insert.title}
        </span>
      </div>
      <div className="flex flex-col px-1.5 pb-1.5">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={index === focusedIndex ? 0 : -1}
              disabled={item.disabled}
              onFocus={() => setFocusedIndex(index)}
              onClick={() => {
                item.onSelect?.();
              }}
              className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                item.disabled
                  ? 'cursor-default opacity-50'
                  : 'cursor-pointer hover:bg-hover-tint'
              }`}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface/70 text-text-primary transition-colors group-hover:bg-card-active">
                <Icon className="size-4" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-[13px] text-text-primary leading-tight">
                  {item.label}
                </span>
                <span className="truncate text-[11px] text-text-muted">
                  {item.description}
                </span>
              </div>
              {item.comingSoon ? (
                <span className="rounded-md bg-surface px-1.5 py-0.5 font-medium text-[9.5px] text-text-muted uppercase tracking-[0.08em]">
                  {strings.canvas.insert.soon}
                </span>
              ) : (
                item.hotkey && (
                  <kbd className="flex min-w-[20px] items-center justify-center rounded-[5px] border border-border-divider bg-card px-1 py-[1px] font-sans font-semibold text-[10px] text-text-secondary">
                    {item.hotkey}
                  </kbd>
                )
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
