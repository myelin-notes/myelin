import { memo, useState } from 'react';
import { Crosshair, ImageDown, Lock, ScanText, Unlock } from 'lucide-react';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import { formatNumber } from '@myelin/editor/i18n/format';
import { IS_DEV } from '@/lib/env';
import { IS_PHONE_BUILD } from '@/lib/viewport-scale';

interface StatusBarProps {
  zoomLevel: number;
  fps: number;
  zoomLocked: boolean;
  onToggleZoomLock: () => void;
  onFitContent: () => void;
  onRegenerateThumbnail: () => void;
  onListRecognizedText: () => Promise<string[]>;
}

export const StatusBar = memo(function StatusBar({
  zoomLevel,
  fps,
  zoomLocked,
  onToggleZoomLock,
  onFitContent,
  onRegenerateThumbnail,
  onListRecognizedText,
}: StatusBarProps) {
  const strings = useMessages();
  const zoomLockLabel = zoomLocked
    ? strings.canvas.statusBar.unlockZoom
    : strings.canvas.statusBar.lockZoom;
  const locale = useLocale();
  const [recognizedText, setRecognizedText] = useState<string[] | null>(null);

  // Compact takes the top-right corner the title bar vacates: the bottom-right
  // is where the tool bar now runs, and this is a passive readout that belongs
  // out of the thumb zone anyway.
  return (
    <div
      className={
        IS_PHONE_BUILD
          ? 'fade-in-0 slide-in-from-top-2 absolute top-3 right-4 z-[100] inline-flex animate-in select-none items-center gap-1 rounded-xl bg-card fill-mode-backwards py-2 pr-3 pl-2 ring-1 ring-border-subtle/70 delay-[100ms] duration-[350ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]'
          : 'fade-in-0 slide-in-from-bottom-2 absolute right-4 bottom-3 z-[100] inline-flex animate-in select-none items-center gap-1 rounded-xl bg-card fill-mode-backwards py-2 pr-3 pl-2 ring-1 ring-border-subtle/70 delay-[100ms] duration-[350ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]'
      }
    >
      <button
        type="button"
        onClick={onFitContent}
        aria-label={strings.canvas.statusBar.fitContent}
        title={strings.canvas.statusBar.fitContent}
        className="cursor-pointer rounded-md border-none bg-transparent p-1 text-text-muted transition-colors hover:bg-hover-tint hover:text-text-secondary"
      >
        <Crosshair className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onToggleZoomLock}
        aria-label={zoomLockLabel}
        aria-pressed={zoomLocked}
        title={zoomLockLabel}
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
          <button
            type="button"
            onClick={() => {
              if (recognizedText) {
                setRecognizedText(null);
              } else {
                void onListRecognizedText().then(setRecognizedText);
              }
            }}
            aria-label="Show recognized handwriting"
            aria-pressed={recognizedText !== null}
            title="Show recognized handwriting (debug)"
            className="cursor-pointer rounded-md border-none bg-transparent p-1 text-text-muted transition-colors hover:bg-hover-tint hover:text-text-secondary"
          >
            <ScanText className="h-3.5 w-3.5" />
          </button>
          {recognizedText && (
            <ol className="absolute right-0 bottom-full mb-2 max-h-80 w-72 select-text list-decimal overflow-y-auto rounded-xl bg-card py-2 pr-3 pl-8 text-text-secondary text-xs ring-1 ring-border-subtle/70">
              {recognizedText.length === 0 ? (
                <li className="list-none text-text-muted">
                  No recognized text
                </li>
              ) : (
                recognizedText.map((text, index) => (
                  <li key={index} className="whitespace-pre-wrap py-0.5">
                    {text}
                  </li>
                ))
              )}
            </ol>
          )}
        </>
      )}
    </div>
  );
});
