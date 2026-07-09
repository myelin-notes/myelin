import { memo } from 'react';
import { Crosshair, ImageDown, Lock, Unlock } from 'lucide-react';
import { motion } from 'motion/react';
import { formatNumber } from '@myelin/editor/i18n/format';
import { IS_DEV } from '@/lib/env';
import { useLocale, useMessages } from '@/lib/i18n';

interface StatusBarProps {
  zoomLevel: number;
  fps: number;
  zoomLocked: boolean;
  onToggleZoomLock: () => void;
  onRecenter: () => void;
  onRegenerateThumbnail: () => void;
}

export const StatusBar = memo(function StatusBar({
  zoomLevel,
  fps,
  zoomLocked,
  onToggleZoomLock,
  onRecenter,
  onRegenerateThumbnail,
}: StatusBarProps) {
  const strings = useMessages();
  const locale = useLocale();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1, ease: [0.25, 0.1, 0.25, 1] }}
      className="absolute right-4 bottom-3 z-[100] inline-flex select-none items-center gap-1 rounded-xl bg-card py-2 pr-3 pl-2 ring-1 ring-border-subtle/70"
    >
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
      {IS_DEV && (
        <>
          <span className="mx-1 text-text-muted/30">|</span>
          <span className="pr-1 font-medium text-text-muted text-xs tabular-nums">
            {strings.canvas.statusBar.fps(fps)}
          </span>
          <button
            type="button"
            onClick={onRegenerateThumbnail}
            aria-label="Regenerate thumbnail"
            title="Regenerate thumbnail (debug)"
            className="cursor-pointer rounded-md border-none bg-transparent p-1 text-text-muted transition-colors hover:bg-hover-tint hover:text-text-secondary"
          >
            <ImageDown className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </motion.div>
  );
});
