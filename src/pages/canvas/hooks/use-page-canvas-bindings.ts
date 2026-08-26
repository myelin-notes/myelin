import { useEffect, useEffectEvent } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { WheelPickerHandle } from '@/components/wheel-picker';
import type { EmbedFilesFn } from './use-embed-files';

/** A resting pen summons the tool wheel after this long (ms). */
const PEN_HOLD_MS = 350;
/** Movement past this (px) during the hold means the pen is drawing, not resting. */
const PEN_HOLD_SLOP = 6;
// Longer than the pen's: a finger has no barrel button to fall back on, is far less precise than
// a tip, and pausing part-way through a pan is ordinary.
const TOUCH_HOLD_MS = 450;
const TOUCH_HOLD_SLOP = 10;
// PointerEvent.buttons bit for a second barrel button, which reports as the middle button. The
// primary barrel erases while held (the canvas owns that), so on two-button pens the wheel gets
// the one above it.
const PEN_WHEEL_BUTTONS = 4;

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
  // The pen may already have begun using the active tool — resting to summon the wheel starts a
  // stroke, and the barrel can be pressed mid-stroke — so whatever is in flight is thrown away.
  // A finger is panning rather than drawing, and the canvas knows whether that gesture is free to take.
  const openToolWheel = useEffectEvent((event: PointerEvent) => {
    const canvas = drawableCanvasRef.current;
    if (event.pointerType === 'touch') {
      if (!canvas?.releaseTouchForToolWheel()) {
        return;
      }
    } else {
      canvas?.abortInteraction();
    }
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
    if (event.pointerType === 'pen' && event.buttons & PEN_WHEEL_BUTTONS) {
      openToolWheel(event);
    }
  });

  const penIsErasing = useEffectEvent(
    () => drawableCanvasRef.current?.penIsErasing ?? false,
  );

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

    // Tracked by pointer id: a palm resting on the screen emits its own moves, and those must not
    // cancel the hold.
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let hold: { id: number; x: number; y: number; slop: number } | null = null;

    const cancelHold = () => {
      if (holdTimer !== null) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      hold = null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      handleCanvasPointerDown(event);
      // A second finger down means the viewport owns the gesture as a pinch,
      // so this also disarms a hold the first finger had started.
      cancelHold();
      // Button 0 is the pen tip.
      const isPen = event.pointerType === 'pen';
      if (
        (!isPen && event.pointerType !== 'touch') ||
        event.button !== 0 ||
        event.shiftKey
      ) {
        return;
      }
      hold = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        slop: isPen ? PEN_HOLD_SLOP : TOUCH_HOLD_SLOP,
      };
      holdTimer = setTimeout(
        () => {
          cancelHold();
          // Asked here rather than when the hold was armed: a barrel pressed
          // after the tip landed starts an erase part-way through the wait,
          // and pausing mid-erase is ordinary — the wheel must not take the
          // gesture away from it.
          if (isPen && penIsErasing()) {
            return;
          }
          openToolWheel(event);
        },
        isPen ? PEN_HOLD_MS : TOUCH_HOLD_MS,
      );
    };
    canvas.addEventListener('pointerdown', handlePointerDown);

    const handlePointerMove = (event: PointerEvent) => {
      if (!hold || event.pointerId !== hold.id) {
        return;
      }
      const moved = Math.hypot(event.clientX - hold.x, event.clientY - hold.y);
      if (moved > hold.slop) {
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
