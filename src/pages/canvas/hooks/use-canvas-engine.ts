import type { WheelPickerHandle } from '@/components/wheel-picker';
import { useKeybindings } from '@/hooks/useKeybindings';
import type { ActionBinding } from '@/lib/keybinds';
import type { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import type { ITool } from '@/pages/canvas/tools/tool';
import { TOOL_ACTIONS } from '@/pages/canvas/tools/tool-keybinds';
import { useCanvasClipboard } from './use-canvas-clipboard';
import { useCanvasSessionLifecycle } from './use-canvas-session-lifecycle';
import { useCanvasSessionPersistence } from './use-canvas-session-persistence';
import { useCanvasThumbnailProducer } from './use-canvas-thumbnail-producer';
import type { EmbedFilesFn } from './use-embed-files';

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
  onInsertFrame: () => void;
  onInsertEmbed: () => void;
  embedFiles: EmbedFilesFn;
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
  onInsertFrame,
  onInsertEmbed,
  embedFiles,
}: UseCanvasEngineArgs) {
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
    noteSession,
  });
  useCanvasThumbnailProducer({ id, canvasRef });
  useCanvasClipboard({
    id,
    drawableCanvasRef,
    embedFiles,
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
    {
      action: 'canvas:insert-frame',
      onDown: () => onInsertFrame(),
    },
    {
      action: 'canvas:insert-embed',
      onDown: () => onInsertEmbed(),
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
  };
}
