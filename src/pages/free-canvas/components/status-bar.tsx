import { motion } from 'motion/react';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useStrings } from '@/lib/i18n';
import { DEBUG } from '@/lib/debug';

interface StatusBarProps {
  zoomLevel: number;
  fps: number;
  noteId?: string;
}

export function StatusBar({ zoomLevel, fps, noteId }: StatusBarProps) {
  const strings = useStrings();
  const locale = useLocale();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1, ease: [0.25, 0.1, 0.25, 1] }}
      className="absolute right-6 bottom-6 z-10 rounded-xl bg-white/80 px-4 py-3 shadow-ambient backdrop-blur-[24px]"
    >
      <span className="font-medium text-text-secondary text-xs tabular-nums">
        {formatNumber(zoomLevel, locale)}%
      </span>
      <span className="mx-2 text-text-muted/30">|</span>
      <span className="font-medium text-text-muted text-xs tabular-nums">
        {strings.canvas.statusBar.fps(fps)}
      </span>
      {DEBUG && noteId && (
        <>
          <span className="mx-2 text-text-muted/30">|</span>
          <span className="font-mono text-[10px] text-text-muted">
            {noteId}
          </span>
        </>
      )}
    </motion.div>
  );
}
