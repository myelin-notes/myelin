import { useEffect, useEffectEvent } from 'react';
import { useMessages } from '@/lib/i18n';
import { UserPrefs } from '@/lib/user-prefs';
import type { ITool } from '@/pages/canvas/tools/tool';

interface ToolShelfProps {
  tools: ITool[];
  enabledIndices: Set<number>;
  onToggle: (index: number) => void;
  onClose: () => void;
  containerRef?: React.RefObject<HTMLElement | null>;
}

export function ToolShelf({
  tools,
  enabledIndices,
  onToggle,
  onClose,
  containerRef,
}: ToolShelfProps) {
  const strings = useMessages();
  const handleWindowPointerDown = useEffectEvent((event: PointerEvent) => {
    const target = event.target as Node;
    if (containerRef?.current?.contains(target)) {
      return;
    }
    onClose();
  });

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      handleWindowPointerDown(event);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  return (
    <div className="fade-in slide-in-from-left-2 w-56 animate-in overflow-hidden rounded-xl bg-white/85 shadow-ambient backdrop-blur-[24px] duration-200">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="font-bold text-[10px] text-text-primary uppercase tracking-[0.1em]">
          {strings.canvas.toolShelf.title}
        </span>
        <button
          onClick={onClose}
          className="cursor-pointer border-none bg-transparent p-0 text-text-muted transition-colors hover:text-text-primary"
        >
          <svg
            className="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        {tools.map((tool, index) => {
          const Icon = tool.icon;
          const enabled = enabledIndices.has(index);
          return (
            <button
              key={index}
              onClick={() => onToggle(index)}
              className={`flex w-full cursor-pointer items-center justify-between rounded-lg border-none px-3 py-2 transition-colors ${
                enabled
                  ? 'bg-secondary-container/30 hover:bg-secondary-container/50'
                  : 'bg-transparent hover:bg-hover-tint'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`size-4 ${enabled ? 'text-accent-dark' : 'text-text-muted'}`}
                />
                <span className="font-medium text-text-primary text-xs">
                  {tool.label}
                </span>
              </div>
              <div
                className={`relative flex h-3.5 w-7 items-center rounded-full px-0.5 transition-colors ${
                  enabled ? 'bg-accent-dark' : 'bg-text-muted/20'
                }`}
              >
                <div
                  className={`h-2.5 w-2.5 rounded-full bg-white transition-transform ${
                    enabled ? 'translate-x-3' : 'translate-x-0'
                  }`}
                />
              </div>
            </button>
          );
        })}
      </div>
      {enabledIndices.size === 0 && (
        <p className="px-4 pb-3 text-[11px] text-text-muted">
          {strings.canvas.toolShelf.empty}
        </p>
      )}
    </div>
  );
}

export function loadWheelToolIndices(toolCount: number): Set<number> {
  const stored = UserPrefs.get('wheelTools');
  if (stored.length > 0) {
    const valid = stored.filter((i) => i >= 0 && i < toolCount);
    if (valid.length > 0) {
      return new Set(valid);
    }
  }
  // Default: all tools enabled
  return new Set(Array.from({ length: toolCount }, (_, i) => i));
}

export function saveWheelToolIndices(indices: Set<number>) {
  UserPrefs.set('wheelTools', [...indices]);
}
