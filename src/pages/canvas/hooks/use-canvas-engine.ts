import { toast } from 'sonner';
import type { WheelPickerHandle } from '@/components/wheel-picker';
import { useKeybindings } from '@/hooks/useKeybindings';
import { useMessages } from '@/lib/i18n';
import type { ActionBinding } from '@/lib/keybinds';
import type { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import type { ITool } from '@/pages/canvas/tools/tool';
import { TOOL_ACTIONS } from '@/pages/canvas/tools/tool-keybinds';
import { SUPPORTED_MEDIA } from '../media';
import { useCanvasSessionLifecycle } from './use-canvas-session-lifecycle';
import { useCanvasSessionPersistence } from './use-canvas-session-persistence';

interface UseCanvasEngineArgs {
  id: string | undefined;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  bgCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
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
  overlayCanvasRef,
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
      overlayCanvasRef,
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

  const toolBindings: ActionBinding[] = canvasTools.map((tool, index) => ({
    action: TOOL_ACTIONS[tool.id],
    onDown: () => {
      drawableCanvasRef.current?.switchTool(index);
      setSelectedToolIndex(index);
    },
  }));

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
    ...toolBindings,
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
