import { type RefObject, useCallback } from 'react';
import { toast } from 'sonner';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { useMessages } from '@myelin/editor/i18n';
import { getMediaImportHandler } from '@myelin/editor/media';
import type { PageFramePasteTarget } from '@myelin/editor/page-frame/anchoring';
import { useRepository } from '@/lib/sync';

export type EmbedFilesFn = (
  files: FileList | File[],
  screenX?: number,
  screenY?: number,
  pageFramePaste?: PageFramePasteTarget,
) => void;

export function useEmbedFiles(
  drawableCanvasRef: RefObject<DrawableCanvas | null>,
): EmbedFilesFn {
  const messages = useMessages();
  const repository = useRepository();

  return useCallback(
    (files, screenX, screenY, pageFramePaste) => {
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
            handler(file, dc, { repository, screenX, screenY, pageFramePaste }),
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
