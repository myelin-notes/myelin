import { toast } from 'sonner';
import type { WheelPickerHandle } from '@/components/wheel-picker';
import { useKeybindings } from '@/hooks/useKeybindings';
import { useMessages } from '@/lib/i18n';
import type { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import type { ITool } from '@/pages/canvas/tools/tool';
import { SUPPORTED_MEDIA } from '../media';
import { useCanvasSessionLifecycle } from './use-canvas-session-lifecycle';
import { useCanvasSessionPersistence } from './use-canvas-session-persistence';

interface UseCanvasEngineArgs {
  id: string | undefined;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  bgCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  domOverlayRef: React.RefObject<HTMLDivElement | null>;
  wheelRef: React.RefObject<WheelPickerHandle | null>;
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>;
  canvasTools: ITool[];
  setSelectedToolIndex: (i: number) => void;
  onCanvasPointerDown: () => void;
}

export function useCanvasEngine({
  id,
  canvasRef,
  bgCanvasRef,
  domOverlayRef,
  wheelRef,
  drawableCanvasRef,
  canvasTools,
  setSelectedToolIndex,
  onCanvasPointerDown,
}: UseCanvasEngineArgs) {
  const messages = useMessages();

  const embedFiles = (
    files: FileList | File[],
    screenX?: number,
    screenY?: number,
  ) => {
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
  };

  const { noteSession, ydoc, zoomLevel, fps, fileName, editingElement } =
    useCanvasSessionLifecycle({
      id,
      canvasRef,
      bgCanvasRef,
      domOverlayRef,
      wheelRef,
      drawableCanvasRef,
      canvasTools,
      embedFiles,
      onCanvasPointerDown,
    });
  const { back } = useCanvasSessionPersistence({
    id,
    canvasRef,
    noteSession,
  });

  useKeybindings([
    {
      action: 'canvas:pan',
      onDown: () => drawableCanvasRef.current?.setSpaceDown(true),
      onUp: () => drawableCanvasRef.current?.setSpaceDown(false),
    },
    {
      action: 'canvas:undo',
      onDown: () => drawableCanvasRef.current?.undo(),
    },
    {
      action: 'canvas:redo',
      onDown: () => drawableCanvasRef.current?.redo(),
    },
    {
      action: 'canvas:delete',
      onDown: () => drawableCanvasRef.current?.deleteSelected(),
    },
    {
      action: 'canvas:tool-text',
      onDown: () => {
        const index = canvasTools.findIndex((t) => t.id === 'text');
        if (index < 0) {
          return;
        }
        drawableCanvasRef.current?.switchTool(index);
        setSelectedToolIndex(index);
      },
    },
    {
      action: 'canvas:tool-frame',
      onDown: () => {
        const index = canvasTools.findIndex((t) => t.id === 'frame');
        if (index < 0) {
          return;
        }
        drawableCanvasRef.current?.switchTool(index);
        setSelectedToolIndex(index);
      },
    },
  ]);

  return {
    drawableCanvasRef,
    noteSession,
    ydoc,
    zoomLevel,
    fps,
    fileName,
    editingElement,
    back,
    embedFiles,
  };
}
