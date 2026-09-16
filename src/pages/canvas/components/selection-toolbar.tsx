import {
  Fragment,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy as CopyIcon,
  Scissors as CutIcon,
  Trash2 as DeleteIcon,
  Lock as LockIcon,
  ArrowDown as MoveBackwardIcon,
  ArrowUp as MoveForwardIcon,
  LockOpen as UnlockIcon,
} from 'lucide-react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { SelectionToolbarItem } from '@myelin/editor/elements/drawable-element';
import { LatexElement } from '@myelin/editor/elements/latex/element';
import { PdfElement } from '@myelin/editor/elements/pdf';
import {
  TextElement,
  type TextStyle,
} from '@myelin/editor/elements/text/element';
import { useMessages } from '@myelin/editor/i18n';
import type { Messages } from '@myelin/editor/i18n/messages';
import {
  TEXT_FONT_SIZE_MAX,
  TEXT_FONT_SIZE_MIN,
  TEXT_FONT_SIZE_STEP,
} from '@myelin/editor/tools/text-tool';
import { FontSizeField } from '@/components/font-size-field';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  findCurrentPdfPage,
  getPdfPageJumpOffset,
} from './pdf-page-navigator-utils';
import { getSelectionToolbarPosition } from './selection-toolbar-position';
import { TextStyleControls } from './text-style-controls';

interface SelectionToolbarProps {
  drawableCanvasRef: RefObject<DrawableCanvas | null>;
  onCopy: () => void;
  onCut: () => void;
}

interface ToolbarState {
  visible: boolean;
  canMoveHigher: boolean;
  canMoveLower: boolean;
  elementItems: SelectionToolbarItem[];
  /** Set when exactly one text box is selected, so its style is editable here. */
  textElement: TextElement | null;
  textStyle: TextStyle | null;
  /** Set when exactly one LaTeX block is selected, so its scale is editable as text size. */
  latexElement: LatexElement | null;
  latexFontSize: number | null;
  pdfElement: PdfElement | null;
  pdfCurrentPage: number | null;
}

const HIDDEN_STATE: ToolbarState = {
  visible: false,
  canMoveHigher: false,
  canMoveLower: false,
  elementItems: [],
  textElement: null,
  textStyle: null,
  latexElement: null,
  latexFontSize: null,
  pdfElement: null,
  pdfCurrentPage: null,
};

const VIEWPORT_MARGIN = 12;
const SELECTION_GAP = 10;
const PDF_PAGE_VIEWPORT_MARGIN = 48;

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
    sameTextStyle(a.textStyle, b.textStyle) &&
    a.latexElement === b.latexElement &&
    a.latexFontSize === b.latexFontSize &&
    a.pdfElement === b.pdfElement &&
    a.pdfCurrentPage === b.pdfCurrentPage
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

function findLatexTarget(canvas: DrawableCanvas): LatexElement | null {
  const selected = canvas.getSelectedElements();
  if (selected.length !== 1) {
    return null;
  }
  const [only] = selected;
  return only instanceof LatexElement ? only : null;
}

function findPdfPageState(canvas: DrawableCanvas): {
  element: PdfElement;
  currentPage: number;
} | null {
  const selected = canvas.getSelectedElements();
  if (selected.length !== 1 || !(selected[0] instanceof PdfElement)) {
    return null;
  }
  const element = selected[0];
  if (element.pageCount < 2) {
    return null;
  }
  const pageBounds = Array.from({ length: element.pageCount }, (_, index) =>
    element.getPageBounds(index),
  );
  const resolvedPageBounds = pageBounds.filter(
    (bounds): bounds is DOMRect => bounds !== null,
  );
  if (resolvedPageBounds.length !== element.pageCount) {
    return null;
  }
  const currentPage = findCurrentPdfPage(
    resolvedPageBounds,
    canvas.viewport.getWorldRect(),
  );
  return currentPage === null ? null : { element, currentPage };
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
  const element = selected[0];
  return [
    ...element.getSelectionToolbarItems(strings, canvas),
    {
      id: 'lock',
      label: element.locked
        ? strings.canvas.selectionToolbar.unlock
        : strings.canvas.selectionToolbar.lock,
      icon: element.locked ? UnlockIcon : LockIcon,
      active: element.locked,
      onClick: () => element.setLocked(!element.locked),
    },
  ];
}

function positionToolbar(toolbar: HTMLDivElement, bounds: DOMRect): void {
  const container = toolbar.offsetParent;
  if (!(container instanceof HTMLElement)) {
    return;
  }
  const containerRect = container.getBoundingClientRect();
  const viewportLeft = window.visualViewport?.offsetLeft ?? 0;
  const viewportTop = window.visualViewport?.offsetTop ?? 0;
  const viewportRight =
    viewportLeft + (window.visualViewport?.width ?? window.innerWidth);
  const viewportBottom =
    viewportTop + (window.visualViewport?.height ?? window.innerHeight);
  const containerLeft = containerRect.left + container.clientLeft;
  const containerTop = containerRect.top + container.clientTop;
  const visibleLeft = Math.max(0, viewportLeft - containerLeft);
  const visibleTop = Math.max(0, viewportTop - containerTop);
  const visibleRight = Math.min(
    container.clientWidth,
    viewportRight - containerLeft,
  );
  const visibleBottom = Math.min(
    container.clientHeight,
    viewportBottom - containerTop,
  );
  const { left, top } = getSelectionToolbarPosition({
    selectionBounds: bounds,
    viewport: {
      left: visibleLeft,
      top: visibleTop,
      width: Math.max(0, visibleRight - visibleLeft),
      height: Math.max(0, visibleBottom - visibleTop),
    },
    toolbarSize: {
      width: toolbar.offsetWidth,
      height: toolbar.offsetHeight,
    },
    viewportMargin: VIEWPORT_MARGIN,
    selectionGap: SELECTION_GAP,
  });

  toolbar.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
}

export function SelectionToolbar({
  drawableCanvasRef,
  onCopy,
  onCut,
}: SelectionToolbarProps) {
  const strings = useMessages();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const pdfPageInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ToolbarState>(HIDDEN_STATE);
  const [editingPdf, setEditingPdf] = useState<PdfElement | null>(null);
  const [pdfPageInput, setPdfPageInput] = useState('');
  const editingPdfPage =
    state.pdfElement !== null && editingPdf === state.pdfElement;

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
          const latexElement = findLatexTarget(canvas);
          const pdfPageState = findPdfPageState(canvas);
          nextState = {
            visible: true,
            canMoveHigher: canvas.canReorderSelection('higher'),
            canMoveLower: canvas.canReorderSelection('lower'),
            elementItems: collectElementItems(canvas, strings),
            textElement,
            textStyle: textElement ? { ...textElement.style } : null,
            latexElement,
            latexFontSize: latexElement ? latexElement.fontSize : null,
            pdfElement: pdfPageState?.element ?? null,
            pdfCurrentPage: pdfPageState?.currentPage ?? null,
          };
        }
      }

      if (bounds && toolbar) {
        positionToolbar(toolbar, bounds);
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
      if (observedToolbar.offsetParent instanceof HTMLElement) {
        resizeObserver.observe(observedToolbar.offsetParent);
      }
    }
    window.visualViewport?.addEventListener('resize', scheduleSync);
    window.visualViewport?.addEventListener('scroll', scheduleSync);

    return () => {
      if (pendingFrame !== 0) {
        cancelAnimationFrame(pendingFrame);
      }
      resizeObserver.disconnect();
      unsubChange();
      unsubView();
      window.removeEventListener('resize', scheduleSync);
      window.visualViewport?.removeEventListener('resize', scheduleSync);
      window.visualViewport?.removeEventListener('scroll', scheduleSync);
    };
  }, [drawableCanvasRef, strings]);

  useLayoutEffect(() => {
    if (editingPdfPage) {
      pdfPageInputRef.current?.select();
    }
  }, [editingPdfPage]);

  const jumpToPdfPage = useCallback(
    (page: number) => {
      const canvas = drawableCanvasRef.current;
      const pdf = state.pdfElement;
      const pageBounds = pdf?.getPageBounds(page);
      if (!(canvas && pdf && pageBounds)) {
        return;
      }
      canvas.viewport.animateOffsetTo(
        getPdfPageJumpOffset({
          pageBounds,
          viewport: canvas.viewport.getWorldRect(),
          zoom: canvas.viewport.zoom,
          margin: PDF_PAGE_VIEWPORT_MARGIN,
        }),
      );
      setEditingPdf(null);
    },
    [drawableCanvasRef, state.pdfElement],
  );

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

  const clipboardItems = useMemo<SelectionToolbarItem[]>(
    () => [
      {
        id: 'copy',
        label: strings.canvas.selectionToolbar.copy,
        icon: CopyIcon,
        onClick: onCopy,
      },
      {
        id: 'cut',
        label: strings.canvas.selectionToolbar.cut,
        icon: CutIcon,
        onClick: onCut,
      },
    ],
    [
      strings.canvas.selectionToolbar.copy,
      strings.canvas.selectionToolbar.cut,
      onCopy,
      onCut,
    ],
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
        {state.pdfElement && state.pdfCurrentPage !== null && (
          <>
            <PdfPageControls
              pdf={state.pdfElement}
              currentPage={state.pdfCurrentPage}
              editing={editingPdfPage}
              pageInput={pdfPageInput}
              setEditing={(editing) =>
                setEditingPdf(editing ? state.pdfElement : null)
              }
              setPageInput={setPdfPageInput}
              inputRef={pdfPageInputRef}
              jumpToPage={jumpToPdfPage}
              strings={strings}
            />
            <Divider />
          </>
        )}
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
        {state.latexElement && state.latexFontSize !== null && (
          <>
            <FontSizeField
              value={state.latexFontSize}
              min={TEXT_FONT_SIZE_MIN}
              max={TEXT_FONT_SIZE_MAX}
              step={TEXT_FONT_SIZE_STEP}
              onChange={(fontSize) => state.latexElement?.setFontSize(fontSize)}
              preserveFocus
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
        <ToolbarItemGroup items={clipboardItems} divided />
        <Divider />
        <ToolbarItemGroup items={deleteItems} />
      </div>
    </TooltipProvider>
  );
}

function PdfPageControls({
  pdf,
  currentPage,
  editing,
  pageInput,
  setEditing,
  setPageInput,
  inputRef,
  jumpToPage,
  strings,
}: {
  pdf: PdfElement;
  currentPage: number;
  editing: boolean;
  pageInput: string;
  setEditing: (editing: boolean) => void;
  setPageInput: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  jumpToPage: (page: number) => void;
  strings: Messages;
}) {
  const pageNumber = currentPage + 1;
  const pageFieldWidth = `calc(${String(pdf.pageCount).length * 2 + 3}ch + 1rem)`;
  return (
    <>
      <button
        type="button"
        className="flex size-8 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent p-0 transition-colors hover:bg-hover-tint focus-visible:outline-none disabled:cursor-default disabled:opacity-35"
        aria-label={strings.canvas.pdfNavigator.previousPage}
        disabled={currentPage === 0}
        onClick={() => jumpToPage(currentPage - 1)}
      >
        <ChevronLeft className="size-4" />
      </button>
      {editing ? (
        <input
          ref={inputRef}
          aria-label={strings.canvas.pdfNavigator.pageNumber}
          className="h-8 shrink-0 rounded-lg border-none bg-hover-tint px-1 text-center text-sm tabular-nums outline-none"
          style={{ width: pageFieldWidth }}
          inputMode="numeric"
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const page = Number.parseInt(pageInput, 10);
              if (
                Number.isInteger(page) &&
                page >= 1 &&
                page <= pdf.pageCount
              ) {
                jumpToPage(page - 1);
              }
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="h-8 shrink-0 cursor-text whitespace-nowrap rounded-lg border-none bg-transparent px-2 text-sm tabular-nums transition-colors hover:bg-hover-tint focus-visible:outline-none"
          style={{ width: pageFieldWidth }}
          aria-label={strings.canvas.pdfNavigator.goToPage}
          onClick={() => {
            setPageInput(String(pageNumber));
            setEditing(true);
          }}
        >
          {pageNumber} / {pdf.pageCount}
        </button>
      )}
      <button
        type="button"
        className="flex size-8 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent p-0 transition-colors hover:bg-hover-tint focus-visible:outline-none disabled:cursor-default disabled:opacity-35"
        aria-label={strings.canvas.pdfNavigator.nextPage}
        disabled={currentPage === pdf.pageCount - 1}
        onClick={() => jumpToPage(currentPage + 1)}
      >
        <ChevronRight className="size-4" />
      </button>
    </>
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
