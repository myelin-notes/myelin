import { useEffect, useRef, useState } from 'react';
import { Palette, X } from 'lucide-react';
import type * as Y from 'yjs';
import { clearCanvasStyle, setCanvasStyle } from '@myelin/editor/canvas-style';
import { useMessages } from '@myelin/editor/i18n';
import { usePresence } from '@myelin/ui';
import { Button } from '@myelin/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCanvasStyle } from '@/lib/use-canvas-style';
import { CanvasStyleEditor } from '@/pages/settings/components/canvas-style-editor';

export function CanvasStyleButton({ doc }: { doc: Y.Doc | null }) {
  const strings = useMessages();
  const perCanvas = strings.settings.canvasStyle.perCanvas;
  const { style, overridden } = useCanvasStyle(doc);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const presence = usePresence(open);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      // The color picker portals to the body; a click in it isn't a click outside.
      if (
        target &&
        (containerRef.current?.contains(target) ||
          target.closest('[role="dialog"]'))
      ) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-label={perCanvas.button}
              disabled={!doc}
            />
          }
        >
          <Palette className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>{perCanvas.button}</TooltipContent>
      </Tooltip>

      {presence.mounted && doc && (
        <div
          {...presence.state}
          onAnimationEnd={presence.onAnimationEnd}
          role="dialog"
          aria-label={perCanvas.button}
          className="data-closed:slide-out-to-top-1 data-closed:fade-out-0 data-open:slide-in-from-top-1 data-open:fade-in-0 absolute top-full right-0 z-[110] mt-2 flex max-h-[80vh] w-[28rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl bg-popover/95 shadow-ambient backdrop-blur-[24px] duration-[140ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] data-closed:animate-out data-open:animate-in"
        >
          <div className="px-4 pt-3 pb-3">
            <div className="flex items-center gap-2">
              <h2 className="m-0 flex-1 font-semibold text-sm text-text-primary">
                {perCanvas.button}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={strings.common.close}
                className="flex size-6 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover-tint hover:text-text-primary"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="mt-1 flex items-baseline gap-3 text-[11px] leading-relaxed">
              <p className="m-0 flex-1 text-text-muted">
                {overridden ? perCanvas.custom : perCanvas.followingDefault}
              </p>
              {overridden && (
                <button
                  type="button"
                  onClick={() => clearCanvasStyle(doc)}
                  className="shrink-0 cursor-pointer font-medium text-text-brand hover:underline"
                >
                  {perCanvas.reset}
                </button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto border-border-subtle/70 border-t px-4 pt-3 pb-4">
            <CanvasStyleEditor
              style={style}
              onChange={(patch) => setCanvasStyle(doc, patch)}
              compact
            />
          </div>
        </div>
      )}
    </div>
  );
}
