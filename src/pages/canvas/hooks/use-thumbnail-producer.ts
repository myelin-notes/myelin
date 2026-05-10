import { useEffect } from 'react';
import { toBlob as htmlToImageBlob } from 'html-to-image';
import { Logger } from '@/lib/logger';
import { getScratchCanvasContext } from '@/lib/scratch-canvas';
import type { VFSNodeId } from '@/lib/sync';
import { registerThumbnailProducer } from '@/lib/thumbnails';

interface UseCanvasThumbnailProducerArgs {
  id: VFSNodeId | undefined;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  thumbnailRootRef: React.RefObject<HTMLElement | null>;
}

const logger = new Logger('CanvasThumbnailProducer');
const EXCLUDE_SELECTOR = '[data-thumbnail-exclude="true"]';

export function useCanvasThumbnailProducer({
  id,
  canvasRef,
  thumbnailRootRef,
}: UseCanvasThumbnailProducerArgs) {
  useEffect(() => {
    if (id === undefined) {
      return;
    }

    return registerThumbnailProducer(id, {
      async render(maxSize) {
        const root = thumbnailRootRef.current;
        if (root !== null && root.clientWidth > 0 && root.clientHeight > 0) {
          try {
            const blob = await renderDomThumbnail(root, maxSize);
            if (blob !== null) {
              return blob;
            }
          } catch (error) {
            logger.warn(
              'DOM thumbnail capture failed; falling back to canvas',
              {
                error,
              },
            );
          }
        }

        return renderCanvasThumbnail(canvasRef.current, maxSize);
      },
    });
  }, [canvasRef, id, thumbnailRootRef]);
}

async function renderDomThumbnail(
  root: HTMLElement,
  maxSize: number,
): Promise<Blob | null> {
  await waitForSettledLayout();

  const sourceWidth = root.clientWidth;
  const sourceHeight = root.clientHeight;
  const longest = Math.max(sourceWidth, sourceHeight);
  if (longest <= 0) {
    return null;
  }

  const scale = Math.min(1, maxSize / longest);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return htmlToImageBlob(root, {
    canvasWidth: width,
    canvasHeight: height,
    pixelRatio: 1,
    skipFonts: true,
    filter: shouldIncludeInThumbnail,
  });
}

async function renderCanvasThumbnail(
  source: HTMLCanvasElement | null,
  maxSize: number,
): Promise<Blob | null> {
  if (source === null || source.width === 0 || source.height === 0) {
    return null;
  }

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

function shouldIncludeInThumbnail(node: HTMLElement): boolean {
  if (!(node instanceof Element)) {
    return true;
  }

  return (
    !node.matches(EXCLUDE_SELECTOR) && node.closest(EXCLUDE_SELECTOR) === null
  );
}

async function waitForSettledLayout(): Promise<void> {
  await document.fonts?.ready.catch(() => undefined);
  await nextAnimationFrame();
  await nextAnimationFrame();
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
