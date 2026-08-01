import { memo } from 'react';
import {
  ClipboardCopy,
  Crosshair,
  ImageDown,
  Lock,
  Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import { exportCanvasPerfTrace } from '@myelin/editor/canvas-perf';
import { formatNumber } from '@myelin/editor/i18n/format';
import { IS_DEV, IS_TABLET_BUILD } from '@/lib/env';
import { useLocale, useMessages } from '@/lib/i18n';

// Keep in sync with useDrawableCanvasViewState, which only threads fps into
// React state when this is true.
const SHOW_FPS = IS_DEV || IS_TABLET_BUILD;

// Hands over the full retained frame history rather than the summary on screen,
// so a device with no Safari Web Inspector can still produce a real trace.
async function copyPerfTrace(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportCanvasPerfTrace());
    toast.success('Performance trace copied');
  } catch (error) {
    toast.error('Could not copy performance trace', {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

interface StatusBarProps {
  zoomLevel: number;
  fps: number;
  perf: string;
  zoomLocked: boolean;
  onToggleZoomLock: () => void;
  onRecenter: () => void;
  onRegenerateThumbnail: () => void;
}

export const StatusBar = memo(function StatusBar({
  zoomLevel,
  fps,
  perf,
  zoomLocked,
  onToggleZoomLock,
  onRecenter,
  onRegenerateThumbnail,
}: StatusBarProps) {
  const strings = useMessages();
  const locale = useLocale();

  return (
    <div className="fade-in-0 slide-in-from-bottom-2 absolute right-4 bottom-3 z-[100] inline-flex animate-in select-none items-center gap-1 rounded-xl bg-card fill-mode-backwards py-2 pr-3 pl-2 ring-1 ring-border-subtle/70 delay-[100ms] duration-[350ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]">
      <button
        type="button"
        onClick={onRecenter}
        aria-label="Center viewport on origin"
        title="Center viewport on origin"
        className="cursor-pointer rounded-md border-none bg-transparent p-1 text-text-muted transition-colors hover:bg-hover-tint hover:text-text-secondary"
      >
        <Crosshair className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onToggleZoomLock}
        aria-label={zoomLocked ? 'Unlock zoom' : 'Lock zoom'}
        aria-pressed={zoomLocked}
        title={zoomLocked ? 'Unlock zoom' : 'Lock zoom'}
        className={
          zoomLocked
            ? 'cursor-pointer rounded-md border-none bg-hover-tint p-1 text-text-primary transition-colors hover:bg-hover-tint'
            : 'cursor-pointer rounded-md border-none bg-transparent p-1 text-text-muted transition-colors hover:bg-hover-tint hover:text-text-secondary'
        }
      >
        {zoomLocked ? (
          <Lock className="h-3.5 w-3.5" />
        ) : (
          <Unlock className="h-3.5 w-3.5" />
        )}
      </button>
      <span
        className={
          zoomLocked
            ? 'pl-1 font-medium text-text-muted/60 text-xs tabular-nums transition-colors'
            : 'pl-1 font-medium text-text-secondary text-xs tabular-nums transition-colors'
        }
      >
        {formatNumber(zoomLevel, locale)}%
      </span>
      {SHOW_FPS && (
        <>
          <span className="mx-1 text-text-muted/30">|</span>
          <span className="pr-1 font-medium text-text-muted text-xs tabular-nums">
            {strings.canvas.statusBar.fps(fps)}
          </span>
        </>
      )}
      {perf !== '' && (
        <>
          <span className="mx-1 text-text-muted/30">|</span>
          <span className="pr-1 font-mono text-[10px] text-text-muted tabular-nums">
            {perf}
          </span>
          <button
            type="button"
            onClick={copyPerfTrace}
            aria-label="Copy performance trace"
            title="Copy performance trace"
            className="cursor-pointer rounded-md border-none bg-transparent p-1 text-text-muted transition-colors hover:bg-hover-tint hover:text-text-secondary"
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      {IS_DEV && (
        <button
          type="button"
          onClick={onRegenerateThumbnail}
          aria-label="Regenerate thumbnail"
          title="Regenerate thumbnail (debug)"
          className="cursor-pointer rounded-md border-none bg-transparent p-1 text-text-muted transition-colors hover:bg-hover-tint hover:text-text-secondary"
        >
          <ImageDown className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});
