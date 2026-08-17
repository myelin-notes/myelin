import { useEffect, useEffectEvent } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { WheelPickerHandle } from '@/components/wheel-picker';
import type { EmbedFilesFn } from './use-embed-files';

/** A resting pen summons the tool wheel after this long (ms). */
const PEN_HOLD_MS = 350;
/** Movement past this (px) during the hold means the pen is drawing, not resting. */
const PEN_HOLD_SLOP = 6;
/** PointerEvent.button for a stylus barrel button. */
const PEN_BARREL_BUTTON = 2;

interface UsePageCanvasBindingsArgs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  wheelRef: React.RefObject<WheelPickerHandle | null>;
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>;
  onCanvasPointerDown: () => void;
  embedFiles: EmbedFilesFn;
}

export function usePageCanvasBindings({
  canvasRef,
  wheelRef,
  drawableCanvasRef,
  onCanvasPointerDown,
  embedFiles,
}: UsePageCanvasBindingsArgs) {
  // The pen may already have begun using the active tool — resting to summon
  // the wheel starts a stroke, and the barrel can be pressed mid-stroke — so
  // whatever is in flight is thrown away rather than committed.
  const openToolWheelWithPen = useEffectEvent((event: PointerEvent) => {
    drawableCanvasRef.current?.abortInteraction();
    wheelRef.current?.show(event);
  });

  const handleCanvasPointerDown = useEffectEvent((event: PointerEvent) => {
    onCanvasPointerDown();
    if (event.shiftKey) {
      return;
    }
    if (event.pointerType === 'mouse') {
      if (event.button === 2) {
        wheelRef.current?.show(event);
      } else {
        wheelRef.current?.hide();
      }
      return;
    }
    // A stylus barrel button is the pen-side right-click, so it opens the wheel
    // outright rather than making the user wait out the hold. Apple Pencils
    // have no barrel button; S Pen / Surface Pen / Wacom do.
    if (event.pointerType === 'pen' && event.button === PEN_BARREL_BUTTON) {
      openToolWheelWithPen(event);
    }
  });

  const handleCanvasDrop = useEffectEvent((event: DragEvent) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (canvas && event.dataTransfer?.files?.length) {
      const rect = canvas.getBoundingClientRect();
      embedFiles(
        Array.from(event.dataTransfer.files),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    }
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const handleContextMenu = (event: MouseEvent) => {
      if (event.shiftKey) {
        return;
      }
      event.preventDefault();
    };
    canvas.addEventListener('contextmenu', handleContextMenu);

    // Pen press-and-hold opens the tool wheel, so the tool can be swapped
    // without setting the pen down. Tracked by pointer id: a palm resting on
    // the screen emits its own moves, and those must not cancel the hold.
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let hold: { id: number; x: number; y: number } | null = null;

    const cancelHold = () => {
      if (holdTimer !== null) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      hold = null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      handleCanvasPointerDown(event);
      cancelHold();
      // Button 0 is the pen tip: the barrel opens the wheel on its own, and the
      // eraser end is there to erase, so neither arms the hold.
      if (event.pointerType !== 'pen' || event.button !== 0 || event.shiftKey) {
        return;
      }
      hold = { id: event.pointerId, x: event.clientX, y: event.clientY };
      holdTimer = setTimeout(() => {
        cancelHold();
        openToolWheelWithPen(event);
      }, PEN_HOLD_MS);
    };
    canvas.addEventListener('pointerdown', handlePointerDown);

    const handlePointerMove = (event: PointerEvent) => {
      if (!hold || event.pointerId !== hold.id) {
        return;
      }
      const moved = Math.hypot(event.clientX - hold.x, event.clientY - hold.y);
      if (moved > PEN_HOLD_SLOP) {
        cancelHold();
      }
    };
    window.addEventListener('pointermove', handlePointerMove);

    const handlePointerUp = (event: PointerEvent) => {
      if (hold && event.pointerId === hold.id) {
        cancelHold();
      }
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    const handleDragOver = (event: DragEvent) => event.preventDefault();
    canvas.addEventListener('dragover', handleDragOver);

    const handleDrop = (event: DragEvent) => {
      handleCanvasDrop(event);
    };
    canvas.addEventListener('drop', handleDrop);

    return () => {
      cancelHold();
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      canvas.removeEventListener('dragover', handleDragOver);
      canvas.removeEventListener('drop', handleDrop);
    };
  }, [canvasRef]);
}
