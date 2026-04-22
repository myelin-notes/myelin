import { useEffect } from 'react';
import { registerThumbnailProducer } from '@/lib/thumbnails';

interface Args {
  id: string | undefined;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function useCanvasThumbnailProducer({ id, canvasRef }: Args) {
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
  }, [id, canvasRef]);
}

async function downscaleToBlob(
  source: HTMLCanvasElement,
  maxSize: number,
): Promise<Blob | null> {
  const longest = Math.max(source.width, source.height);
  const scale = Math.min(1, maxSize / longest);
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));

  if (typeof OffscreenCanvas !== 'undefined') {
    const off = new OffscreenCanvas(w, h);
    const ctx = off.getContext('2d');
    if (ctx === null) {
      return null;
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    return await off.convertToBlob({ type: 'image/png' });
  }

  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext('2d');
  if (ctx === null) {
    return null;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return await new Promise<Blob | null>((resolve) => {
    tmp.toBlob((blob) => resolve(blob), 'image/png');
  });
}
