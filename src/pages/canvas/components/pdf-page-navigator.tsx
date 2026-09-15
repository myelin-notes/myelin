import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { PdfElement } from '@myelin/editor/elements/pdf';
import { useMessages } from '@myelin/editor/i18n';
import type { Messages } from '@myelin/editor/i18n/messages';
import { IS_PHONE_BUILD } from '@/lib/viewport-scale';
import {
  findCurrentPdfPage,
  getNavigatorPosition,
  getPdfPageJumpOffset,
} from './pdf-page-navigator-utils';

interface PdfPageNavigatorProps {
  drawableCanvasRef: RefObject<DrawableCanvas | null>;
}

interface NavigatorState {
  pdf: PdfElement;
  currentPage: number;
  left: number;
  top: number;
}

const BOTTOM_INSET = 16;
const PHONE_TOOLBAR_HEIGHT = 72;
// The selected PDF's generic toolbar is clamped to the same viewport edge.
const SELECTION_TOOLBAR_RESERVE = 52;
const PAGE_VIEWPORT_MARGIN = 48;
const NAVIGATOR_MIN_WIDTH = IS_PHONE_BUILD ? 168 : 136;
const NAVIGATOR_MIN_HEIGHT = IS_PHONE_BUILD ? 52 : 40;

function selectedPdf(canvas: DrawableCanvas): PdfElement | null {
  const selected = canvas.getSelectedElements();
  return selected.length === 1 && selected[0] instanceof PdfElement
    ? selected[0]
    : null;
}

export function PdfPageNavigator({ drawableCanvasRef }: PdfPageNavigatorProps) {
  const strings = useMessages();
  const navigatorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<NavigatorState | null>(null);
  const [editingPdf, setEditingPdf] = useState<PdfElement | null>(null);
  const [pageInput, setPageInput] = useState('');
  const editing = state !== null && editingPdf === state.pdf;

  useEffect(() => {
    const canvas = drawableCanvasRef.current;
    if (!canvas) {
      return;
    }
    let pendingFrame = 0;
    const sync = () => {
      const pdf = selectedPdf(canvas);
      if (!pdf || pdf.pageCount < 2) {
        setState(null);
        return;
      }
      const viewport = canvas.viewport.getWorldRect();
      const pageBounds = Array.from({ length: pdf.pageCount }, (_, index) =>
        pdf.getPageBounds(index),
      );
      const resolvedPageBounds = pageBounds.filter(
        (bounds): bounds is DOMRect => bounds !== null,
      );
      if (resolvedPageBounds.length !== pdf.pageCount) {
        setState(null);
        return;
      }
      const currentPage = findCurrentPdfPage(resolvedPageBounds, viewport);
      const pdfTopLeft = canvas.viewport.worldToScreen({
        x: pdf.boundingBox.left,
        y: pdf.boundingBox.top,
      });
      const pdfBottomRight = canvas.viewport.worldToScreen({
        x: pdf.boundingBox.right,
        y: pdf.boundingBox.bottom,
      });
      const measuredWidth = navigatorRef.current?.offsetWidth ?? 0;
      const measuredHeight = navigatorRef.current?.offsetHeight ?? 0;
      const position = getNavigatorPosition({
        pdfBounds: {
          left: Math.min(pdfTopLeft.x, pdfBottomRight.x),
          top: Math.min(pdfTopLeft.y, pdfBottomRight.y),
          width: Math.abs(pdfBottomRight.x - pdfTopLeft.x),
          height: Math.abs(pdfBottomRight.y - pdfTopLeft.y),
        },
        viewport: {
          left: 0,
          top: 0,
          width: viewport.width * canvas.viewport.zoom,
          height: viewport.height * canvas.viewport.zoom,
        },
        navigatorSize: {
          width: Math.max(NAVIGATOR_MIN_WIDTH, measuredWidth),
          height: Math.max(NAVIGATOR_MIN_HEIGHT, measuredHeight),
        },
        edgeInset: BOTTOM_INSET,
        viewportBottomInset:
          BOTTOM_INSET +
          SELECTION_TOOLBAR_RESERVE +
          (IS_PHONE_BUILD ? PHONE_TOOLBAR_HEIGHT : 0),
      });
      if (currentPage === null || position === null) {
        setState(null);
        return;
      }
      setState((previous) => {
        if (
          previous?.pdf === pdf &&
          previous.currentPage === currentPage &&
          previous.left === position.left &&
          previous.top === position.top
        ) {
          return previous;
        }
        return { pdf, currentPage, ...position };
      });
    };
    const scheduleSync = () => {
      if (pendingFrame) {
        return;
      }
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        sync();
      });
    };
    scheduleSync();
    const unsubscribeChange = canvas.onChange(scheduleSync);
    const unsubscribeView = canvas.viewport.onViewChange(scheduleSync);
    const resizeObserver = new ResizeObserver(scheduleSync);
    if (navigatorRef.current) {
      resizeObserver.observe(navigatorRef.current);
    }
    window.addEventListener('resize', scheduleSync);
    return () => {
      cancelAnimationFrame(pendingFrame);
      unsubscribeChange();
      unsubscribeView();
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleSync);
    };
  }, [drawableCanvasRef]);

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  const jumpToPage = useCallback(
    (page: number) => {
      if (!state) {
        return;
      }
      const canvas = drawableCanvasRef.current;
      const pageBounds = state.pdf.getPageBounds(page);
      if (!canvas || !pageBounds) {
        return;
      }
      const viewport = canvas.viewport.getWorldRect();
      canvas.viewport.animateOffsetTo(
        getPdfPageJumpOffset({
          pageBounds,
          viewport,
          zoom: canvas.viewport.zoom,
          margin: PAGE_VIEWPORT_MARGIN,
        }),
      );
      setEditingPdf(null);
    },
    [drawableCanvasRef, state],
  );

  return (
    <div
      ref={navigatorRef}
      className={`absolute top-0 left-0 z-[110] flex items-center gap-1 rounded-xl bg-popover/85 p-1 text-text-secondary shadow-ambient ring-1 ring-border-ghost/70 backdrop-blur-[24px] ${
        state ? 'pointer-events-auto' : 'pointer-events-none invisible'
      }`}
      style={{
        transform: `translate3d(${state?.left ?? 0}px, ${state?.top ?? 0}px, 0)`,
      }}
      role="toolbar"
      aria-label={strings.canvas.pdfNavigator.label}
      aria-hidden={!state}
    >
      {state && (
        <NavigatorControls
          state={state}
          editing={editing}
          pageInput={pageInput}
          setEditing={(nextEditing) =>
            setEditingPdf(nextEditing ? state.pdf : null)
          }
          setPageInput={setPageInput}
          inputRef={inputRef}
          jumpToPage={jumpToPage}
          strings={strings}
        />
      )}
    </div>
  );
}

function NavigatorControls({
  state,
  editing,
  pageInput,
  setEditing,
  setPageInput,
  inputRef,
  jumpToPage,
  strings,
}: {
  state: NavigatorState;
  editing: boolean;
  pageInput: string;
  setEditing: (editing: boolean) => void;
  setPageInput: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  jumpToPage: (page: number) => void;
  strings: Messages;
}) {
  const total = state.pdf.pageCount;
  const pageNumber = state.currentPage + 1;
  const stepButtonSize = IS_PHONE_BUILD ? 'size-11' : 'size-8';
  const pageButtonSize = IS_PHONE_BUILD ? 'h-11 min-w-16' : 'h-8 min-w-14';
  return (
    <>
      <button
        type="button"
        className={`flex ${stepButtonSize} cursor-pointer items-center justify-center rounded-lg border-none bg-transparent p-0 transition-colors hover:bg-hover-tint focus-visible:outline-none disabled:cursor-default disabled:opacity-35`}
        aria-label={strings.canvas.pdfNavigator.previousPage}
        disabled={state.currentPage === 0}
        onClick={() => jumpToPage(state.currentPage - 1)}
      >
        <ChevronLeft className="size-4" />
      </button>
      {editing ? (
        <input
          ref={inputRef}
          aria-label={strings.canvas.pdfNavigator.pageNumber}
          className={`${pageButtonSize} rounded-lg border-none bg-hover-tint px-1 text-center text-sm tabular-nums outline-none`}
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
              if (Number.isInteger(page) && page >= 1 && page <= total) {
                jumpToPage(page - 1);
              }
            }
          }}
        />
      ) : (
        <button
          type="button"
          className={`${pageButtonSize} cursor-text rounded-lg border-none bg-transparent px-2 text-sm tabular-nums transition-colors hover:bg-hover-tint focus-visible:outline-none`}
          aria-label={strings.canvas.pdfNavigator.goToPage}
          onClick={() => {
            setPageInput(String(pageNumber));
            setEditing(true);
          }}
        >
          {pageNumber} / {total}
        </button>
      )}
      <button
        type="button"
        className={`flex ${stepButtonSize} cursor-pointer items-center justify-center rounded-lg border-none bg-transparent p-0 transition-colors hover:bg-hover-tint focus-visible:outline-none disabled:cursor-default disabled:opacity-35`}
        aria-label={strings.canvas.pdfNavigator.nextPage}
        disabled={state.currentPage === total - 1}
        onClick={() => jumpToPage(state.currentPage + 1)}
      >
        <ChevronRight className="size-4" />
      </button>
    </>
  );
}
