import { type RefObject, useEffect, useRef, useState } from 'react';
import { TextQuote } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { DrawableCanvas, Vector2 } from '@myelin/editor/drawable-canvas';
import { PageFrameElement } from '@myelin/editor/elements/page-frame-element';
import { PdfElement } from '@myelin/editor/elements/pdf';
import {
  insertPdfQuote,
  type PdfQuote,
} from '@myelin/editor/elements/pdf/quote';
import { TextElement } from '@myelin/editor/elements/text/element';
import { useMessages } from '@myelin/editor/i18n';

const SELECTION_GAP = 8;
// World units, sized like a short quote in a page.
const GHOST_SIZE = { x: 0, y: 0, width: 240, height: 48 };

interface PdfQuoteButtonProps {
  drawableCanvasRef: RefObject<DrawableCanvas | null>;
}

interface ShownQuote {
  quote: PdfQuote;
  left: number;
  top: number;
}

function placeQuote(
  canvas: DrawableCanvas,
  quote: PdfQuote,
  point: Vector2,
): void {
  const frame = canvas.anchoring.findFrame(point);
  if (!(frame instanceof PageFrameElement)) {
    // Plain text box: canvas text has no links, so the label stays unlinked.
    canvas.addElement((uuid) => {
      const element = new TextElement(
        uuid,
        `${quote.text}\n— ${quote.label}`,
        {},
        GHOST_SIZE.width,
      );
      element.setOffset(point.x, point.y);
      return element;
    });
    return;
  }
  const view = frame.pmEditor?.view;
  const pos = canvas.anchoring.textPositionAt(frame, point);
  if (view && pos !== null) {
    view.dispatch(insertPdfQuote(view.state, pos, quote));
  }
}

/** Sits under a text selection in an edited PDF; quoting drops the text where the next tap lands. */
export function PdfQuoteButton({ drawableCanvasRef }: PdfQuoteButtonProps) {
  const strings = useMessages();
  const ref = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState<ShownQuote | null>(null);
  const visible = shown !== null;

  useEffect(() => {
    const canvas = drawableCanvasRef.current;
    if (!canvas) {
      return;
    }
    let pendingFrame = 0;
    const sync = () => {
      pendingFrame = 0;
      const editing = canvas.editingElement;
      const quote =
        editing instanceof PdfElement ? editing.getSelectedQuote() : null;
      const selection = document.getSelection();
      if (!(quote && selection?.rangeCount)) {
        setShown(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setShown({
        quote,
        left: rect.left + rect.width / 2,
        top: rect.bottom + SELECTION_GAP,
      });
    };
    const schedule = () => {
      if (pendingFrame === 0) {
        pendingFrame = requestAnimationFrame(sync);
      }
    };
    document.addEventListener('selectionchange', schedule);
    const unsubChange = canvas.onChange(schedule);
    const unsubView = canvas.viewport.onViewChange(schedule);
    return () => {
      cancelAnimationFrame(pendingFrame);
      document.removeEventListener('selectionchange', schedule);
      unsubChange();
      unsubView();
    };
  }, [drawableCanvasRef]);

  // Native, like FloatingToolbar's: the canvas's document-level pointerdown would exit PDF edit mode
  // and unmount this button before its click fires.
  useEffect(() => {
    const button = ref.current;
    if (!(visible && button)) {
      return;
    }
    const block = (event: PointerEvent) => event.stopPropagation();
    button.addEventListener('pointerdown', block);
    return () => button.removeEventListener('pointerdown', block);
  }, [visible]);

  if (!shown) {
    return null;
  }

  const startPlacement = () => {
    const canvas = drawableCanvasRef.current;
    if (!canvas) {
      return;
    }
    const { quote } = shown;
    canvas.startPlacement({
      getBounds: () => GHOST_SIZE,
      onPlace: (point) => placeQuote(canvas, quote, point),
    });
  };

  return createPortal(
    <button
      ref={ref}
      type="button"
      className="fade-in-0 zoom-in-95 fixed z-50 flex h-8 -translate-x-1/2 animate-in cursor-pointer items-center gap-1.5 rounded-xl bg-card/80 px-2.5 text-sm text-text-secondary shadow-ambient backdrop-blur-[24px] duration-150 hover:text-text-primary"
      style={{
        left: shown.left,
        top: shown.top,
        border: '1px solid var(--border-ghost)',
      }}
      // Keeps the PDF text selection alive until the click lands.
      onPointerDown={(event) => event.preventDefault()}
      onClick={startPlacement}
    >
      <TextQuote className="size-4" />
      {strings.canvas.pdfQuote.quote}
    </button>,
    document.body,
  );
}
