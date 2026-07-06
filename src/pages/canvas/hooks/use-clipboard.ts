import { type RefObject, useEffect, useEffectEvent, useMemo } from 'react';
import { CanvasClipboardController } from '@myelin/editor/clipboard/controller';
import { DrawableCanvasClipboardAdapter } from '@myelin/editor/clipboard/drawable-canvas-adapter';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
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
  const controller = useMemo(() => new CanvasClipboardController(), []);
  const handleMediaPaste = useEffectEvent((event: ClipboardEvent) => {
    const files = extractEmbeddableClipboardFiles(event);
    if (files.length === 0) {
      return false;
    }

    embedFiles(files);
    return true;
  });

  useEffect(() => {
    if (!id) {
      return;
    }

    const adapter = new DrawableCanvasClipboardAdapter(drawableCanvasRef, id);
    const handleCopy = (event: ClipboardEvent) => {
      controller.handleCopy(event, adapter);
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
  }, [controller, drawableCanvasRef, id]);
}
