import {
  Fragment,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Trash2 as DeleteIcon,
  ArrowDown as MoveBackwardIcon,
  ArrowUp as MoveForwardIcon,
} from 'lucide-react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { SelectionToolbarItem } from '@myelin/editor/elements/drawable-element';
import {
  TextElement,
  type TextStyle,
} from '@myelin/editor/elements/text/element';
import { useMessages } from '@myelin/editor/i18n';
import type { Messages } from '@myelin/editor/i18n/messages';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { TextStyleControls } from './text-style-controls';

interface SelectionToolbarProps {
  drawableCanvasRef: RefObject<DrawableCanvas | null>;
}

interface ToolbarState {
  visible: boolean;
  canMoveHigher: boolean;
  canMoveLower: boolean;
  elementItems: SelectionToolbarItem[];
  /** Set when exactly one text box is selected, so its style is editable here. */
  textElement: TextElement | null;
  textStyle: TextStyle | null;
}

const HIDDEN_STATE: ToolbarState = {
  visible: false,
  canMoveHigher: false,
  canMoveLower: false,
  elementItems: [],
  textElement: null,
  textStyle: null,
};

const VIEWPORT_MARGIN = 12;
const SELECTION_GAP = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sameElementItems(
  a: SelectionToolbarItem[],
  b: SelectionToolbarItem[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.label !== y.label ||
      x.icon !== y.icon ||
      (x.active ?? false) !== (y.active ?? false) ||
      (x.disabled ?? false) !== (y.disabled ?? false)
    ) {
      return false;
    }
  }
  return true;
}

function sameTextStyle(a: TextStyle | null, b: TextStyle | null): boolean {
  if (!(a && b)) {
    return a === b;
  }
  return (
    a.color === b.color &&
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily
  );
}

function sameToolbarState(a: ToolbarState, b: ToolbarState): boolean {
  return (
    a.visible === b.visible &&
    a.canMoveHigher === b.canMoveHigher &&
    a.canMoveLower === b.canMoveLower &&
    sameElementItems(a.elementItems, b.elementItems) &&
    a.textElement === b.textElement &&
    sameTextStyle(a.textStyle, b.textStyle)
  );
}

function findTextTarget(canvas: DrawableCanvas): TextElement | null {
  const selected = canvas.getSelectedElements();
  if (selected.length !== 1) {
    return null;
  }
  const [only] = selected;
  return only instanceof TextElement ? only : null;
}

function collectElementItems(
  canvas: DrawableCanvas,
  strings: Messages,
): SelectionToolbarItem[] {
  // Element-specific items only when exactly one element is selected — actions
  // like crop don't have meaningful multi-selection semantics.
  const selected = canvas.getSelectedElements();
  if (selected.length !== 1) {
    return [];
  }
  return selected[0].getSelectionToolbarItems(strings);
}

export function SelectionToolbar({ drawableCanvasRef }: SelectionToolbarProps) {
  const strings = useMessages();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ToolbarState>(HIDDEN_STATE);

  useEffect(() => {
    const canvas = drawableCanvasRef.current;
    if (!canvas) {
      return;
    }

    let currentState = HIDDEN_STATE;

    const sync = () => {
      const toolbar = toolbarRef.current;
      let bounds: DOMRect | null = null;
      // Hiding only flips `visible` — the toolbar fades out over 150ms, and clearing the contents here
      // would play that fade on a toolbar already collapsed to its element-agnostic buttons.
      let nextState: ToolbarState = { ...currentState, visible: false };
      const editing = canvas.editingElement;
      if (
        (!editing ||
          canvas.isCanvasInteractiveEditMode ||
          editing.keepsSelectionToolbarWhileEditing) &&
        !canvas.isPlacing
      ) {
        bounds = canvas.getSelectedElementScreenBounds();
        if (bounds) {
          const textElement = findTextTarget(canvas);
          nextState = {
            visible: true,
            canMoveHigher: canvas.canReorderSelection('higher'),
            canMoveLower: canvas.canReorderSelection('lower'),
            elementItems: collectElementItems(canvas, strings),
            textElement,
            textStyle: textElement ? { ...textElement.style } : null,
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

    // sync() centers on the width it measures, but the content deciding that width is rendered by the
    // setState below it — so the pass that swaps contents always positions against the previous width.
    // The text style controls swing it wide enough to see, so re-position once the layout has settled.
    const observedToolbar = toolbarRef.current;
    const resizeObserver = new ResizeObserver(scheduleSync);
    if (observedToolbar) {
      resizeObserver.observe(observedToolbar);
    }

    return () => {
      if (pendingFrame !== 0) {
        cancelAnimationFrame(pendingFrame);
      }
      resizeObserver.disconnect();
      unsubChange();
      unsubView();
      window.removeEventListener('resize', scheduleSync);
    };
  }, [drawableCanvasRef, strings]);

  const moveHigher = useCallback(() => {
    drawableCanvasRef.current?.reorderSelection('higher');
  }, [drawableCanvasRef]);

  const moveLower = useCallback(() => {
    drawableCanvasRef.current?.reorderSelection('lower');
  }, [drawableCanvasRef]);

  const deleteSelection = useCallback(() => {
    drawableCanvasRef.current?.deleteSelected();
  }, [drawableCanvasRef]);

  const deleteItems = useMemo<SelectionToolbarItem[]>(
    () => [
      {
        id: 'delete',
        label: strings.canvas.selectionToolbar.delete,
        icon: DeleteIcon,
        onClick: deleteSelection,
      },
    ],
    [strings.canvas.selectionToolbar.delete, deleteSelection],
  );

  const reorderItems = useMemo<SelectionToolbarItem[]>(
    () => [
      {
        id: 'move-higher',
        label: strings.canvas.selectionToolbar.moveHigher,
        icon: MoveForwardIcon,
        disabled: !state.canMoveHigher,
        onClick: moveHigher,
      },
      {
        id: 'move-lower',
        label: strings.canvas.selectionToolbar.moveLower,
        icon: MoveBackwardIcon,
        disabled: !state.canMoveLower,
        onClick: moveLower,
      },
    ],
    [
      strings.canvas.selectionToolbar.moveHigher,
      strings.canvas.selectionToolbar.moveLower,
      state.canMoveHigher,
      state.canMoveLower,
      moveHigher,
      moveLower,
    ],
  );

  return (
    <TooltipProvider>
      <div
        ref={toolbarRef}
        data-selection-toolbar="true"
        className={`pointer-events-auto absolute top-0 left-0 z-[110] flex items-center gap-1 rounded-xl bg-popover/85 px-1.5 py-1.5 text-text-secondary shadow-ambient ring-1 ring-border-ghost/70 backdrop-blur-[24px] transition-opacity duration-150 ${
          state.visible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        role="toolbar"
        aria-label={strings.canvas.selectionToolbar.label}
        aria-hidden={!state.visible}
      >
        {state.textElement && state.textStyle && (
          <>
            <TextStyleControls
              key={state.textElement.uuid}
              element={state.textElement}
              style={state.textStyle}
            />
            <Divider />
          </>
        )}
        <ToolbarItemGroup items={state.elementItems} />
        {state.elementItems.length > 0 && reorderItems.length > 0 && (
          <Divider />
        )}
        <ToolbarItemGroup items={reorderItems} divided />
        <Divider />
        <ToolbarItemGroup items={deleteItems} />
      </div>
    </TooltipProvider>
  );
}

function ToolbarItemGroup({
  items,
  divided,
}: {
  items: SelectionToolbarItem[];
  divided?: boolean;
}) {
  return (
    <>
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {divided && index > 0 && <Divider />}
          <ToolbarButton item={item} />
        </Fragment>
      ))}
    </>
  );
}

function Divider() {
  return <div className="h-5 w-px bg-border-divider/70" />;
}

function ToolbarButton({ item }: { item: SelectionToolbarItem }) {
  const Icon = item.icon;
  const disabled = item.disabled ?? false;
  const active = item.active ?? false;
  const baseClass =
    'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors focus-visible:outline-none data-disabled:cursor-default data-disabled:opacity-35';
  const activeClass = active
    ? 'bg-accent-dark text-text-on-dark hover:bg-accent-dark hover:text-text-on-dark focus-visible:bg-accent-dark focus-visible:text-text-on-dark'
    : 'bg-transparent text-inherit hover:bg-hover-tint hover:text-text-primary focus-visible:bg-hover-tint focus-visible:text-text-primary data-disabled:hover:bg-transparent data-disabled:hover:text-inherit';
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={item.label}
        aria-pressed={item.active ?? undefined}
        aria-disabled={disabled}
        data-disabled={disabled ? 'true' : undefined}
        className={`${baseClass} ${activeClass}`}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          item.onClick();
        }}
      >
        <Icon className="size-3.5" strokeWidth={2} />
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{item.label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
