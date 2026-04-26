import { useEffect, useEffectEvent } from 'react';
import type { WheelPickerHandle } from '@/components/wheel-picker';
import type { EmbedFilesFn } from './use-embed-files';

interface UsePageCanvasBindingsArgs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  wheelRef: React.RefObject<WheelPickerHandle | null>;
  onCanvasPointerDown: () => void;
  embedFiles: EmbedFilesFn;
}

export function usePageCanvasBindings({
  canvasRef,
  wheelRef,
  onCanvasPointerDown,
  embedFiles,
}: UsePageCanvasBindingsArgs) {
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
    }
  });

  const handleCanvasDrop = useEffectEvent((event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) {
      embedFiles(
        Array.from(event.dataTransfer.files),
        event.pageX,
        event.pageY,
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

    const handlePointerDown = (event: PointerEvent) => {
      handleCanvasPointerDown(event);
    };
    canvas.addEventListener('pointerdown', handlePointerDown);

    const handleDragOver = (event: DragEvent) => event.preventDefault();
    canvas.addEventListener('dragover', handleDragOver);

    const handleDrop = (event: DragEvent) => {
      handleCanvasDrop(event);
    };
    canvas.addEventListener('drop', handleDrop);

    return () => {
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('dragover', handleDragOver);
      canvas.removeEventListener('drop', handleDrop);
    };
  }, [canvasRef]);
}
