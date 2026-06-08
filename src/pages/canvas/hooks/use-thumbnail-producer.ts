import { useEffect } from 'react';
import type { VFSNodeId } from '@/lib/sync';
import {
  registerThumbnailProducer,
  requestThumbnailRegeneration,
} from '@/lib/thumbnails';
import { renderCanvasThumbnail } from '../canvas-thumbnail';
import type { DrawableCanvas } from '../drawable-canvas';

interface UseCanvasThumbnailProducerArgs {
  id: VFSNodeId | undefined;
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>;
  thumbnailRootRef: React.RefObject<HTMLElement | null>;
}

const EDITING_FINISHED_THUMBNAIL_DELAY_MS = 3_000;

export function useCanvasThumbnailProducer({
  id,
  drawableCanvasRef,
  thumbnailRootRef,
}: UseCanvasThumbnailProducerArgs) {
  useEffect(() => {
    if (id === undefined) {
      return;
    }

    return registerThumbnailProducer(id, {
      async render(maxSize) {
        const canvas = drawableCanvasRef.current;
        if (canvas === null) {
          return null;
        }
        return renderCanvasThumbnail(
          canvas.elements,
          canvas.contentBounds,
          maxSize,
        );
      },
    });
  }, [drawableCanvasRef, id]);

  useEffect(() => {
    if (id === undefined) {
      return;
    }

    const root = thumbnailRootRef.current;
    if (root === null) {
      return;
    }

    const handleFocusOut = (event: FocusEvent) => {
      if (
        event.target instanceof HTMLElement &&
        root.contains(event.target) &&
        isEditableElement(event.target)
      ) {
        requestThumbnailRegeneration(id, {
          delayMs: EDITING_FINISHED_THUMBNAIL_DELAY_MS,
        });
      }
    };

    root.addEventListener('focusout', handleFocusOut);
    return () => {
      root.removeEventListener('focusout', handleFocusOut);
    };
  }, [id, thumbnailRootRef]);
}

function isEditableElement(element: HTMLElement): boolean {
  return (
    element.isContentEditable ||
    element.matches('input, textarea, [contenteditable="true"]') ||
    element.closest('[contenteditable="true"]') !== null
  );
}
