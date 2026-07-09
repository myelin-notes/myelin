import { useEffect, useState } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { DrawableElement } from '@myelin/editor/elements/drawable-element';
import { startDrawableCanvasAnimationLoop } from '@myelin/editor/render-loop';

interface DrawableCanvasViewState {
  zoomLevel: number;
  fps: number;
  editingElement: DrawableElement | null;
}

const EMPTY_VIEW_STATE: DrawableCanvasViewState = {
  zoomLevel: 100,
  fps: 0,
  editingElement: null,
};

export function useDrawableCanvasViewState(
  drawableCanvas: DrawableCanvas | null,
): DrawableCanvasViewState {
  const [viewState, setViewState] =
    useState<DrawableCanvasViewState>(EMPTY_VIEW_STATE);

  useEffect(() => {
    if (!drawableCanvas) {
      setViewState(EMPTY_VIEW_STATE);
      return;
    }

    const canvas = drawableCanvas;

    setViewState({
      zoomLevel: Math.round(canvas.viewport.zoom * 100),
      fps: 0,
      editingElement: canvas.editingElement,
    });

    canvas.viewport.setOnZoomChange((zoom) => {
      setViewState((current) => ({
        ...current,
        zoomLevel: Math.round(zoom * 100),
      }));
    });
    canvas.setOnElementEdit((editingElement) => {
      setViewState((current) => ({
        ...current,
        editingElement,
      }));
    });
    const stopAnimation = startDrawableCanvasAnimationLoop(canvas, (fps) => {
      setViewState((current) => ({
        ...current,
        fps,
      }));
    });

    return () => {
      stopAnimation();
      canvas.viewport.setOnZoomChange(() => {});
      canvas.setOnElementEdit(() => {});
    };
  }, [drawableCanvas]);

  return viewState;
}
