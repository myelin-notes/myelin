import { IS_DEV } from '@/lib/env';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';

interface StatusBarProps {
  zoomLevel: number;
  fps: number;
}

export function StatusBar({ zoomLevel, fps }: StatusBarProps) {
  const strings = useMessages();
  const locale = useLocale();

  return (
    <div className="pointer-events-none absolute right-4 bottom-3 z-[100] select-none">
      <span className="font-medium text-text-secondary text-xs tabular-nums">
        {formatNumber(zoomLevel, locale)}%
      </span>
      {IS_DEV && (
        <>
          <span className="mx-2 text-text-muted/30">|</span>
          <span className="font-medium text-text-muted text-xs tabular-nums">
            {strings.canvas.statusBar.fps(fps)}
          </span>
        </>
      )}
    </div>
  );
}
