import { useEffect } from 'react';
import { registerThumbnailProducer } from '@/lib/thumbnails';

interface UseCanvasThumbnailProducerArgs {
  id: string | undefined;
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

  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(width, height);
    const context = offscreen.getContext('2d');
    if (context === null) {
      return null;
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    return await offscreen.convertToBlob({ type: 'image/png' });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) {
    return null;
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
