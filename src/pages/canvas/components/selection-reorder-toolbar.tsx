import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowDown as MoveBackwardIcon,
  ArrowUp as MoveForwardIcon,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useMessages } from '@/lib/i18n';
import type { DrawableCanvas } from '@/pages/canvas/drawable-canvas';

interface SelectionReorderToolbarProps {
  drawableCanvasRef: RefObject<DrawableCanvas | null>;
}

interface ToolbarState {
  visible: boolean;
  canMoveHigher: boolean;
  canMoveLower: boolean;
}

const HIDDEN_STATE: ToolbarState = {
  visible: false,
  canMoveHigher: false,
  canMoveLower: false,
};

const VIEWPORT_MARGIN = 12;
const SELECTION_GAP = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sameToolbarState(a: ToolbarState, b: ToolbarState): boolean {
  return (
    a.visible === b.visible &&
    a.canMoveHigher === b.canMoveHigher &&
    a.canMoveLower === b.canMoveLower
  );
}

export function SelectionReorderToolbar({
  drawableCanvasRef,
}: SelectionReorderToolbarProps) {
  const strings = useMessages();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ToolbarState>(HIDDEN_STATE);

  useEffect(() => {
    let frameId = 0;
    let currentState = HIDDEN_STATE;

    const sync = () => {
      const canvas = drawableCanvasRef.current;
      const toolbar = toolbarRef.current;
      let bounds: DOMRect | null = null;
      let nextState = HIDDEN_STATE;
      if (canvas && !canvas.editingElement && !canvas.isPlacing) {
        bounds = canvas.getSelectedElementScreenBounds();
        if (bounds) {
          nextState = {
            visible: true,
            canMoveHigher: canvas.canReorderSelection('higher'),
            canMoveLower: canvas.canReorderSelection('lower'),
          };
        }
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

      if (!sameToolbarState(currentState, nextState)) {
        currentState = nextState;
        setState(nextState);
      }

      frameId = requestAnimationFrame(sync);
    };

    frameId = requestAnimationFrame(sync);
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [drawableCanvasRef]);

  const moveHigher = useCallback(() => {
    drawableCanvasRef.current?.reorderSelection('higher');
  }, [drawableCanvasRef]);

  const moveLower = useCallback(() => {
    drawableCanvasRef.current?.reorderSelection('lower');
  }, [drawableCanvasRef]);

  return (
    <TooltipProvider>
      <div
        ref={toolbarRef}
        data-selection-reorder-toolbar="true"
        className={`pointer-events-auto absolute top-0 left-0 z-[110] flex items-center gap-1 rounded-xl bg-white/85 px-1.5 py-1.5 text-text-secondary shadow-ambient ring-1 ring-border-ghost/70 backdrop-blur-[24px] transition-opacity duration-150 ${
          state.visible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        role="toolbar"
        aria-label={strings.canvas.selectionToolbar.label}
        aria-hidden={!state.visible}
      >
        <ToolbarButton
          label={strings.canvas.selectionToolbar.moveHigher}
          shortLabel={strings.canvas.selectionToolbar.moveHigherShort}
          disabled={!state.canMoveHigher}
          onClick={moveHigher}
        >
          <MoveForwardIcon className="size-3.5" strokeWidth={2} />
        </ToolbarButton>
        <div className="h-5 w-px bg-border-divider/70" />
        <ToolbarButton
          label={strings.canvas.selectionToolbar.moveLower}
          shortLabel={strings.canvas.selectionToolbar.moveLowerShort}
          disabled={!state.canMoveLower}
          onClick={moveLower}
        >
          <MoveBackwardIcon className="size-3.5" strokeWidth={2} />
        </ToolbarButton>
      </div>
    </TooltipProvider>
  );
}

function ToolbarButton({
  label,
  shortLabel,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortLabel: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        aria-disabled={disabled}
        data-disabled={disabled ? 'true' : undefined}
        className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-transparent px-2.5 font-medium text-[12px] text-inherit transition-colors hover:bg-hover-tint hover:text-text-primary focus-visible:bg-hover-tint focus-visible:text-text-primary focus-visible:outline-none data-disabled:cursor-default data-disabled:opacity-35 data-disabled:hover:bg-transparent data-disabled:hover:text-inherit"
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          onClick();
        }}
      >
        {children}
        <span>{shortLabel}</span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
