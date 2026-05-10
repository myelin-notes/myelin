import { useEffect } from 'react';
import { toCanvas as htmlToImageCanvas } from 'html-to-image';
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
            const blob = await renderDomThumbnail(
              root,
              canvasRef.current,
              maxSize,
            );
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
  inkCanvas: HTMLCanvasElement | null,
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

  const domCanvas = await htmlToImageCanvas(root, {
    canvasWidth: width,
    canvasHeight: height,
    pixelRatio: 1,
    filter: (node) => shouldIncludeInThumbnail(node, inkCanvas),
  });

  return compositeDomAndInk(domCanvas, inkCanvas, width, height);
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

function shouldIncludeInThumbnail(
  node: HTMLElement,
  inkCanvas: HTMLCanvasElement | null,
): boolean {
  // html-to-image's filter is typed (HTMLElement) but is invoked on every
  // child node, including Text/Comment which aren't Elements.
  if (!(node instanceof Element)) {
    return true;
  }
  return (
    node !== inkCanvas &&
    !node.matches(EXCLUDE_SELECTOR) &&
    node.closest(EXCLUDE_SELECTOR) === null
  );
}

async function compositeDomAndInk(
  domCanvas: HTMLCanvasElement,
  inkCanvas: HTMLCanvasElement | null,
  width: number,
  height: number,
): Promise<Blob | null> {
  const scratch = getScratchCanvasContext(width, height);

  try {
    const ctx = scratch.context;
    ctx.drawImage(domCanvas, 0, 0, width, height);
    if (inkCanvas !== null && inkCanvas.width > 0 && inkCanvas.height > 0) {
      ctx.drawImage(inkCanvas, 0, 0, width, height);
    }
    return await scratch.toBlob({ type: 'image/png' });
  } finally {
    scratch.release();
  }
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
