import { memo, type ReactNode } from 'react';
import { useCompactCanvasLayout } from '@/hooks/use-compact-canvas-layout';
import { IS_MOBILE_BUILD } from '@/lib/env';
import { type Action, registry } from '@/lib/keybinds';

interface TitleBarProps {
  trailing?: ReactNode;
}

/**
 * Tooltip body for a title-bar button: label plus its key combo, styled to
 * match the canvas toolbar's tool tooltips. The combo is hidden on mobile,
 * where there's no keyboard to press it with.
 */
export function TitleBarTooltip({
  label,
  action,
}: {
  label: string;
  action: Action;
}) {
  const hotkey = IS_MOBILE_BUILD ? '' : registry.format(action);
  return (
    <div className="flex items-center gap-2">
      <span>{label}</span>
      {hotkey && (
        <kbd className="flex min-w-[18px] items-center justify-center rounded-[4px] border border-white/20 bg-white/10 px-1 py-[1px] font-sans font-semibold text-[10px] text-white/80">
          {hotkey}
        </kbd>
      )}
    </div>
  );
}

export const TitleBar = memo(function TitleBar({ trailing }: TitleBarProps) {
  const compact = useCompactCanvasLayout();

  if (!trailing) {
    return null;
  }

  // Compact drops these into the thumb zone just above the tool bar: undo and
  // redo live here, and the top corners of a tall phone are the hardest point
  // to reach one-handed.
  return (
    <div
      className={
        compact
          ? 'fade-in-0 slide-in-from-bottom-2 absolute right-3 bottom-[5rem] z-[100] flex animate-in items-center gap-2 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border-subtle/70 duration-[350ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]'
          : 'fade-in-0 slide-in-from-top-2 absolute top-6 right-6 z-[100] flex animate-in items-center gap-2 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border-subtle/70 duration-[350ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]'
      }
    >
      {trailing}
    </div>
  );
});
