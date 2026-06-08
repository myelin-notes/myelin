import { useMemo } from 'react';
import { AllSelection } from 'prosemirror-state';
import type { WheelPickerHandle } from '@/components/wheel-picker';
import { useKeybindings } from '@/hooks/useKeybindings';
import type { ActionBinding } from '@/lib/keybinds';
import type { VFSNodeId } from '@/lib/sync';
import type { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import { ElementType } from '@/pages/canvas/elements/element-type';
import type { PageFrameElement } from '@/pages/canvas/elements/page-frame-element';
import type { ITool } from '@/pages/canvas/tools/tool';
import { TOOL_ACTIONS } from '@/pages/canvas/tools/tool-keybinds';
import { useCanvasClipboard } from './use-clipboard';
import { useDrawableCanvasViewState } from './use-drawable-canvas-view-state';
import type { EmbedFilesFn } from './use-embed-files';
import { usePageCanvasBindings } from './use-page-canvas-bindings';
import { useCanvasSessionController } from './use-session-controller';
import { useCanvasSessionSaving } from './use-session-saving';
import { useCanvasThumbnailProducer } from './use-thumbnail-producer';

interface UseCanvasEngineArgs {
  id: VFSNodeId | undefined;
  initialPageFrameName?: string | null;
  thumbnailRootRef: React.RefObject<HTMLElement | null>;
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
  initialPageFrameName,
  thumbnailRootRef,
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
  usePageCanvasBindings({
    canvasRef,
    wheelRef,
    onCanvasPointerDown,
    embedFiles,
  });
  useCanvasThumbnailProducer({
    id,
    drawableCanvasRef,
    thumbnailRootRef,
  });

  const sessionController = useCanvasSessionController({
    id,
    initialPageFrameName,
    canvasRef,
    bgCanvasRef,
    overlayCanvasRef,
    domOverlayRef,
    drawableCanvasRef,
    canvasTools,
  });
  const canvasViewState = useDrawableCanvasViewState(drawableCanvasRef.current);
  const saving = useCanvasSessionSaving({
    noteId: id,
    noteSession: sessionController.noteSession,
  });

  useCanvasClipboard({
    id,
    drawableCanvasRef,
    embedFiles,
  });

  const toolBindings = useMemo<ActionBinding[]>(
    () =>
      canvasTools.map((tool, index) => ({
        action: TOOL_ACTIONS[tool.id],
        onDown: () => {
          drawableCanvasRef.current?.switchTool(index);
          setSelectedToolIndex(index);
        },
      })),
    [canvasTools, drawableCanvasRef, setSelectedToolIndex],
  );

  const keyBindings = useMemo<ActionBinding[]>(
    () => [
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
        action: 'canvas:select-all',
        onDown: (event) => {
          event.preventDefault();
          if (canvasViewState.editingElement?.type === ElementType.PAGE_FRAME) {
            const view = (canvasViewState.editingElement as PageFrameElement)
              .pmEditor?.view;
            if (view) {
              view.dispatch(
                view.state.tr.setSelection(new AllSelection(view.state.doc)),
              );
              view.focus();
              return;
            }
          }
          drawableCanvasRef.current?.selectAllElements();
        },
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
    ],
    [
      canvasViewState.editingElement,
      drawableCanvasRef,
      onInsertEmbed,
      onInsertFrame,
      toolBindings,
    ],
  );
  useKeybindings(keyBindings);

  return {
    drawableCanvasRef,
    ...canvasViewState,
    ...sessionController,
    ...saving,
  };
}
