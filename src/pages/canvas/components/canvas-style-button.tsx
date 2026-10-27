import { useEffect, useRef, useState } from 'react';
import { Palette, X } from 'lucide-react';
import type * as Y from 'yjs';
import { clearCanvasStyle, setCanvasStyle } from '@myelin/editor/canvas-style';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
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
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <h2 className="m-0 flex-1 font-semibold text-[13px] text-text-primary">
              {perCanvas.title}
            </h2>
            {overridden && (
              <button
                type="button"
                onClick={() => clearCanvasStyle(doc)}
                className="cursor-pointer rounded-md px-2 py-1 font-medium text-[11px] text-text-secondary transition-colors hover:bg-hover-tint hover:text-text-primary"
              >
                {perCanvas.reset}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={strings.common.close}
              className="flex size-6 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover-tint hover:text-text-primary"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <p
            className={cn(
              'm-0 px-4 pb-3 text-[11px] leading-relaxed',
              overridden ? 'text-text-secondary' : 'text-text-muted',
            )}
          >
            {overridden ? perCanvas.custom : perCanvas.followingDefault}
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <CanvasStyleEditor
              style={style}
              onChange={(patch) => setCanvasStyle(doc, patch)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
