import { useEffect } from 'react';
import { getScratchCanvasContext } from '@/lib/scratch-canvas';
import type { FileId } from '@/lib/sync';
import { registerThumbnailProducer } from '@/lib/thumbnails';

interface UseCanvasThumbnailProducerArgs {
  id: FileId | undefined;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function useCanvasThumbnailProducer({
  id,
  canvasRef,
}: UseCanvasThumbnailProducerArgs) {
  useEffect(() => {
    if (id === undefined) {
      return;
    }

    return registerThumbnailProducer(id, {
      async render(maxSize) {
        const source = canvasRef.current;
        if (source === null || source.width === 0 || source.height === 0) {
          return null;
        }
        return downscaleToBlob(source, maxSize);
      },
    });
  }, [canvasRef, id]);
}

async function downscaleToBlob(
  source: HTMLCanvasElement,
  maxSize: number,
): Promise<Blob | null> {
  const longest = Math.max(source.width, source.height);
  const scale = Math.min(1, maxSize / longest);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const scratch = getScratchCanvasContext(width, height);

  try {
    scratch.context.imageSmoothingQuality = 'high';
    scratch.context.drawImage(source, 0, 0, width, height);
    return await scratch.toBlob({ type: 'image/png' });
  } finally {
    scratch.release();
  }
}
