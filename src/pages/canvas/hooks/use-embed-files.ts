import { type RefObject, useCallback } from 'react';
import { toast } from 'sonner';
import { useMessages } from '@/lib/i18n';
import { useRepository } from '@/lib/sync';
import type { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import { getMediaImportHandler } from '../media';

export type EmbedFilesFn = (
  files: FileList | File[],
  screenX?: number,
  screenY?: number,
) => void;

export function useEmbedFiles(
  drawableCanvasRef: RefObject<DrawableCanvas | null>,
): EmbedFilesFn {
  const messages = useMessages();
  const repository = useRepository();

  return useCallback(
    (files, screenX, screenY) => {
      const dc = drawableCanvasRef.current;
      if (!dc) {
        return;
      }
      for (const file of files) {
        const handler = getMediaImportHandler(file.type);
        if (!handler) {
          toast.error(messages.canvas.embedComposer.errors.unsupportedType, {
            description: messages.canvas.embedComposer.errors.unsupportedDesc(
              file.type,
            ),
          });
        } else {
          void Promise.resolve(
            handler(file, dc, { repository, screenX, screenY }),
          ).catch((error) => {
            toast.error(messages.canvas.embedComposer.errors.embedFailed, {
              description:
                error instanceof Error ? error.message : String(error),
            });
          });
        }
      }
    },
    [drawableCanvasRef, messages, repository],
  );
}
