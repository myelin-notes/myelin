import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Trash2 as DeleteIcon } from 'lucide-react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useMessages } from '@/lib/i18n';

interface SelectionToolbarProps {
  drawableCanvasRef: RefObject<DrawableCanvas | null>;
}

const VIEWPORT_MARGIN = 12;
const SELECTION_GAP = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Floating toolbar with a delete action, mirroring the app's selection toolbar.
 * It tracks the current selection's screen bounds and positions itself just
 * above (or below) the selected element(s).
 */
export function SelectionToolbar({ drawableCanvasRef }: SelectionToolbarProps) {
  const strings = useMessages();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const canvas = drawableCanvasRef.current;
    if (!canvas) {
      return;
    }

    let currentVisible = false;

    const sync = () => {
      const toolbar = toolbarRef.current;
      let bounds: DOMRect | null = null;
      if (
        (!canvas.editingElement || canvas.isCanvasInteractiveEditMode) &&
        !canvas.isPlacing
      ) {
        bounds = canvas.getSelectedElementScreenBounds();
      }

      if (bounds && toolbar) {
        const toolbarWidth = toolbar.offsetWidth;
        const toolbarHeight = toolbar.offsetHeight;
        const minLeft = VIEWPORT_MARGIN;
        const maxLeft = window.innerWidth - VIEWPORT_MARGIN - toolbarWidth;
        const left = clamp(
          bounds.left + bounds.width / 2 - toolbarWidth / 2,
          minLeft,
          Math.max(minLeft, maxLeft),
        );
        const aboveTop = bounds.top - toolbarHeight - SELECTION_GAP;
        const belowTop = bounds.bottom + SELECTION_GAP;
        const maxTop = window.innerHeight - VIEWPORT_MARGIN - toolbarHeight;
        const top = clamp(
          aboveTop >= VIEWPORT_MARGIN ? aboveTop : belowTop,
          VIEWPORT_MARGIN,
          Math.max(VIEWPORT_MARGIN, maxTop),
        );

        toolbar.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      }

      const nextVisible = bounds !== null;
      if (currentVisible !== nextVisible) {
        currentVisible = nextVisible;
        setVisible(nextVisible);
      }
    };

    let pendingFrame = 0;
    const scheduleSync = () => {
      if (pendingFrame !== 0) {
        return;
      }
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        sync();
      });
    };

    sync();
    const unsubChange = canvas.onChange(scheduleSync);
    const unsubView = canvas.viewport.onViewChange(scheduleSync);
    window.addEventListener('resize', scheduleSync);

    return () => {
      if (pendingFrame !== 0) {
        cancelAnimationFrame(pendingFrame);
      }
      unsubChange();
      unsubView();
      window.removeEventListener('resize', scheduleSync);
    };
  }, [drawableCanvasRef]);

  const deleteSelection = useCallback(() => {
    drawableCanvasRef.current?.deleteSelected();
  }, [drawableCanvasRef]);

  return (
    <TooltipProvider>
      <div
        ref={toolbarRef}
        data-selection-toolbar="true"
        className={`pointer-events-auto absolute top-0 left-0 z-[110] flex items-center gap-1 rounded-xl bg-popover/85 px-1.5 py-1.5 text-text-secondary shadow-ambient ring-1 ring-border-ghost/70 backdrop-blur-[24px] transition-opacity duration-150 ${
          visible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        role="toolbar"
        aria-label={strings.canvas.selectionToolbar.label}
        aria-hidden={!visible}
      >
        <Tooltip>
          <TooltipTrigger
            aria-label={strings.canvas.selectionToolbar.delete}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-transparent text-inherit transition-colors hover:bg-hover-tint hover:text-text-primary focus-visible:bg-hover-tint focus-visible:text-text-primary focus-visible:outline-none"
            onClick={deleteSelection}
          >
            <DeleteIcon className="size-3.5" strokeWidth={2} />
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{strings.canvas.selectionToolbar.delete}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
