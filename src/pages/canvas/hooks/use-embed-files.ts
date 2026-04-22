import { type RefObject, useCallback } from 'react';
import { toast } from 'sonner';
import { useMessages } from '@/lib/i18n';
import type { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import { SUPPORTED_MEDIA } from '../media';

export type EmbedFilesFn = (
  files: FileList | File[],
  screenX?: number,
  screenY?: number,
) => void;

export function useEmbedFiles(
  drawableCanvasRef: RefObject<DrawableCanvas | null>,
): EmbedFilesFn {
  const messages = useMessages();

  return useCallback(
    (files, screenX, screenY) => {
      const dc = drawableCanvasRef.current;
      if (!dc) {
        return;
      }
      for (const file of files) {
        const handler = SUPPORTED_MEDIA[file.type];
        if (!handler) {
          toast.error(messages.canvas.embedComposer.errors.unsupportedType, {
            description: messages.canvas.embedComposer.errors.unsupportedDesc(
              file.type,
            ),
          });
        } else {
          handler(file, dc, screenX, screenY);
        }
      }
    },
    [drawableCanvasRef, messages],
  );
}
