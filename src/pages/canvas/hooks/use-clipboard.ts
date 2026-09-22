import {
  type RefObject,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
} from 'react';
import { toast } from 'sonner';
import { CanvasClipboardController } from '@myelin/editor/clipboard/controller';
import { DrawableCanvasClipboardAdapter } from '@myelin/editor/clipboard/drawable-canvas-adapter';
import {
  MYELIN_CANVAS_CLIPBOARD_LABEL,
  MYELIN_CANVAS_CLIPBOARD_MIME,
} from '@myelin/editor/clipboard/formats';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { useMessages } from '@myelin/editor/i18n';
import type { VFSNodeId } from '@/lib/sync';
import type { EmbedFilesFn } from './use-embed-files';

interface UseCanvasClipboardArgs {
  id: VFSNodeId | undefined;
  drawableCanvasRef: RefObject<DrawableCanvas | null>;
  embedFiles: EmbedFilesFn;
}

function extractEmbeddableClipboardFiles(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.items;
  if (!items) {
    return [];
  }

  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (
      item.type.startsWith('image/') ||
      item.type.startsWith('audio/') ||
      item.type === 'application/pdf'
    ) {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }

  return files;
}

export function useCanvasClipboard({
  id,
  drawableCanvasRef,
  embedFiles,
}: UseCanvasClipboardArgs) {
  const strings = useMessages();
  const controller = useMemo(() => new CanvasClipboardController(), []);
  const copiedCanvasPayloadRef = useRef<string | null>(null);
  const handleMediaPaste = useEffectEvent((event: ClipboardEvent) => {
    const files = extractEmbeddableClipboardFiles(event);
    if (files.length === 0) {
      return false;
    }

    embedFiles(files);
    return true;
  });
  const copy = useEffectEvent(async (): Promise<boolean> => {
    if (!id) {
      return false;
    }

    const adapter = new DrawableCanvasClipboardAdapter(drawableCanvasRef, id);
    const payload = controller.copyPayload(adapter);
    if (!payload) {
      return false;
    }

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          [MYELIN_CANVAS_CLIPBOARD_MIME]: new Blob([payload], {
            type: MYELIN_CANVAS_CLIPBOARD_MIME,
          }),
          'text/plain': new Blob([MYELIN_CANVAS_CLIPBOARD_LABEL], {
            type: 'text/plain',
          }),
        }),
      ]);
      copiedCanvasPayloadRef.current = payload;
      return true;
    } catch {
      return false;
    }
  });
  const paste = useEffectEvent(async () => {
    if (!id) {
      return;
    }

    const adapter = new DrawableCanvasClipboardAdapter(drawableCanvasRef, id);
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes(MYELIN_CANVAS_CLIPBOARD_MIME)) {
          const payload = await (
            await item.getType(MYELIN_CANVAS_CLIPBOARD_MIME)
          ).text();
          if (controller.pastePayload(payload, adapter)) {
            return;
          }
        }
      }

      for (const item of items) {
        if (
          item.types.includes('text/plain') &&
          (await (await item.getType('text/plain')).text()) ===
            MYELIN_CANVAS_CLIPBOARD_LABEL
        ) {
          const payload = copiedCanvasPayloadRef.current;
          if (payload && controller.pastePayload(payload, adapter)) {
            return;
          }
        }
      }

      const files: File[] = [];
      for (const item of items) {
        for (const type of item.types) {
          if (
            type.startsWith('image/') ||
            type.startsWith('audio/') ||
            type === 'application/pdf'
          ) {
            files.push(
              new File([await item.getType(type)], 'clipboard', { type }),
            );
          }
        }
      }
      if (files.length > 0) {
        embedFiles(files);
      }
    } catch {
      const payload = copiedCanvasPayloadRef.current;
      if (payload && controller.pastePayload(payload, adapter)) {
        return;
      }
    }
  });

  useEffect(() => {
    if (!id) {
      return;
    }

    const adapter = new DrawableCanvasClipboardAdapter(drawableCanvasRef, id);
    const handleCopy = (event: ClipboardEvent) => {
      if (controller.handleCopy(event, adapter)) {
        copiedCanvasPayloadRef.current =
          event.clipboardData?.getData(MYELIN_CANVAS_CLIPBOARD_MIME) ?? null;
        toast.success(strings.canvas.selectionToolbar.copied);
      }
    };
    const handleCut = (event: ClipboardEvent) => {
      controller.handleCut(event, adapter);
    };
    const handlePaste = (event: ClipboardEvent) => {
      controller.handlePaste(event, adapter, handleMediaPaste);
    };

    document.addEventListener('copy', handleCopy);
    document.addEventListener('cut', handleCut);
    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('cut', handleCut);
      document.removeEventListener('paste', handlePaste);
    };
  }, [
    controller,
    drawableCanvasRef,
    id,
    strings.canvas.selectionToolbar.copied,
  ]);

  return {
    copy: () => {
      void (async () => {
        if (await copy()) {
          toast.success(strings.canvas.selectionToolbar.copied);
        }
      })();
    },
    cut: () => {
      void (async () => {
        if (await copy()) {
          drawableCanvasRef.current?.deleteSelected();
        }
      })();
    },
    paste,
  };
}
