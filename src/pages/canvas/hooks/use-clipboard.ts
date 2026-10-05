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
import { invoke } from '@tauri-apps/api/core';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
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

async function readClipboardImageFile(): Promise<File> {
  const response = await invoke<ArrayBuffer | number[]>(
    'read_clipboard_image_png',
  );
  const bytes =
    response instanceof ArrayBuffer
      ? response
      : Uint8Array.from(response).buffer;
  return new File([bytes], 'clipboard.png', { type: 'image/png' });
}

async function readNativePasteEvent(
  copiedCanvasPayload: string | null,
): Promise<ClipboardEvent | null> {
  const [textResult, imageResult] = await Promise.allSettled([
    readText(),
    readClipboardImageFile(),
  ]);
  const clipboardData = new DataTransfer();

  if (textResult.status === 'fulfilled') {
    clipboardData.setData('text/plain', textResult.value);
    if (
      textResult.value === MYELIN_CANVAS_CLIPBOARD_LABEL &&
      copiedCanvasPayload
    ) {
      clipboardData.setData(MYELIN_CANVAS_CLIPBOARD_MIME, copiedCanvasPayload);
    }
  }
  if (imageResult.status === 'fulfilled') {
    clipboardData.items.add(imageResult.value);
  }
  if (clipboardData.items.length === 0) {
    return null;
  }

  return new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData,
  });
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
  const handlePaste = useEffectEvent((event: ClipboardEvent) => {
    if (!id) {
      return;
    }
    const adapter = new DrawableCanvasClipboardAdapter(drawableCanvasRef, id);
    controller.handlePaste(event, adapter, handleMediaPaste);
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

    const event = await readNativePasteEvent(copiedCanvasPayloadRef.current);
    if (event) {
      handlePaste(event);
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
